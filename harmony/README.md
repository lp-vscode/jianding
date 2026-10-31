# 简盯 HarmonyOS

这是一个 Stage 模型的 ArkWeb 壳，直接装载仓库上一级的 Vue 盯盘前端。网页负责交互与本地数据，HarmonyOS 壳提供应用入口、系统通知和返回手势。

构建：

```bash
bash harmony/build-hap.sh
```

设备在线后可安装签名 HAP：

```bash
/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc install -r <signed.hap>
```
