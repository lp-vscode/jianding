#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
HAP="${1:-$HERE/entry/build/default/outputs/default/entry-default-signed.hap}"
DEVECO="${DEVECO_HOME:-/Applications/DevEco-Studio.app}"
JAVA="$DEVECO/Contents/jbr/Contents/Home/bin/java"
SIGN_TOOL="$DEVECO/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"

FAILURES=0
WARNINGS=0
fail() {
  FAILURES=$((FAILURES + 1))
  printf 'FAIL  %s\n' "$1"
}
warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'WARN  %s\n' "$1"
}
pass() {
  printf 'PASS  %s\n' "$1"
}

if [[ ! -f "$HAP" ]]; then
  fail "HAP 不存在：$HAP"
  exit 1
fi

CHECK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/jianding-store-check.XXXXXX")"
trap 'rm -rf "$CHECK_TMP"' EXIT
unzip -q "$HAP" -d "$CHECK_TMP"

if "$JAVA" -jar "$SIGN_TOOL" verify-app \
  -inFile "$HAP" \
  -outCertChain "$CHECK_TMP/chain.cer" \
  -outProfile "$CHECK_TMP/profile.p7b" >"$CHECK_TMP/verify.log" 2>&1; then
  pass "HAP 签名校验通过"
else
  fail "HAP 签名校验失败，详见 $CHECK_TMP/verify.log"
fi

STATIC_OUTPUT="$(python3 - "$CHECK_TMP" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
failures = 0
warnings = 0

def fail(message):
    global failures
    failures += 1
    print(f"FAIL  {message}")

def warn(message):
    global warnings
    warnings += 1
    print(f"WARN  {message}")

def pass_check(message):
    print(f"PASS  {message}")

module = json.loads((root / "module.json").read_text(encoding="utf-8"))
app = module.get("app", {})
module_info = module.get("module", {})
if app.get("debug") is True:
    fail("当前是 debug 构建，不可直接提交 AppGallery")
else:
    pass_check("HAP 不是 debug 构建")
if str(app.get("buildMode", "")).lower() != "release":
    fail(f"buildMode 不是 release：{app.get('buildMode')!r}")
else:
    pass_check("buildMode 为 release")

bundle = app.get("bundleName")
if bundle == "com.jianding.marketwatch":
    pass_check(f"Bundle 名正确：{bundle}")
else:
    fail(f"Bundle 名异常：{bundle!r}")
if app.get("versionName") and int(app.get("versionCode", 0)) > 0:
    pass_check(f"版本信息有效：{app.get('versionName')} ({app.get('versionCode')})")
else:
    fail("版本名称或 versionCode 缺失")

permissions = {
    item.get("name")
    for item in module_info.get("requestPermissions", [])
    if isinstance(item, dict)
}
unexpected = permissions - {"ohos.permission.INTERNET"}
if unexpected:
    fail(f"存在未说明的权限：{', '.join(sorted(unexpected))}")
else:
    pass_check("仅声明 INTERNET 权限")

raw = root / "resources" / "rawfile" / "dist"
if (raw / "index.html").is_file():
    pass_check("本地 Web 首页存在")
else:
    fail("缺少 rawfile/dist/index.html")
if list(raw.glob("assets/*.css")):
    pass_check("本地样式资源存在")
else:
    fail("缺少本地样式资源")

icon = root / "resources" / "base" / "media" / "app_icon.png"
if icon.is_file():
    pass_check("应用图标已打包")
else:
    fail("缺少应用图标 resources/base/media/app_icon.png")

index = (raw / "index.html").read_text(encoding="utf-8") if (raw / "index.html").is_file() else ""
if '<script type="module">' in index:
    pass_check("ArkWeb 启动脚本已内联")
else:
    warn("入口脚本未内联，需在真机复核 resource://rawfile 加载")

profile_json = None
profile_path = root / "profile.p7b"
if profile_path.is_file():
    data = profile_path.read_bytes()
    start = data.find(b"{")
    if start >= 0:
        try:
            profile_json = json.JSONDecoder().raw_decode(data[start:].decode("utf-8", "ignore"))[0]
        except Exception:
            profile_json = None
if profile_json:
    if profile_json.get("type") == "release":
        pass_check("签名 Profile 类型为 release")
    else:
        fail(f"签名 Profile 类型为 {profile_json.get('type')!r}，正式提审需 release")
    if not profile_json.get("debug-info", {}).get("device-ids"):
        pass_check("Release Profile 未绑定单机 UDID")
    else:
        fail("Profile 绑定单机 UDID，不能用于商店发布")
else:
    warn("无法读取签名 Profile；请用 hap-sign-tool 人工核对")

print(f"SUMMARY failures={failures} warnings={warnings}")
raise SystemExit(0)
PY
)"
printf '%s\n' "$STATIC_OUTPUT"
FAILURES=$((FAILURES + $(printf '%s\n' "$STATIC_OUTPUT" | grep -c '^FAIL' || true)))
WARNINGS=$((WARNINGS + $(printf '%s\n' "$STATIC_OUTPUT" | grep -c '^WARN' || true)))

echo
echo "静态检查只证明包结构和技术门禁，不代替 AGC 审核。"
echo "隐私政策、发布证书、备案、商店资料与内容分级仍需在 AppGallery Connect 完成。"
if (( FAILURES > 0 )); then
  printf 'RESULT not-store-ready failures=%d warnings=%d\n' "$FAILURES" "$WARNINGS"
  exit 1
fi
printf 'RESULT store-static-checks-passed failures=0 warnings=%d\n' "$WARNINGS"
