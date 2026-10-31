import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { fileIo, picker } from '@kit.CoreFileKit';
import { notificationManager } from '@kit.NotificationKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { http } from '@kit.NetworkKit';

const DOMAIN: number = 0x4A44;
const TAG: string = 'JiandingWeb';

interface MarketRequestPayload {
  requestId: string;
  url: string;
}

class NativeBridge {
  onRequestNotificationPermission: () => Promise<boolean> = async (): Promise<boolean> => false;
  onNotify: (title: string, body: string) => Promise<boolean> = async (): Promise<boolean> => false;
  onSaveTextFile: (fileName: string, contents: string) => Promise<boolean> = async (): Promise<boolean> => false;
  onFetchMarketText: (url: string, requestId: string) => void = (): void => {};

  requestNotificationPermission(): Promise<boolean> {
    return this.onRequestNotificationPermission();
  }

  notify(title: string, body: string): Promise<boolean> {
    return this.onNotify(title, body);
  }

  saveTextFile(fileName: string, contents: string): Promise<boolean> {
    return this.onSaveTextFile(fileName, contents);
  }

  fetchMarketText(url: string, requestId: string): string {
    this.onFetchMarketText(url, requestId);
    return 'started';
  }
}

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: NativeBridge = new NativeBridge();
  private webReady: boolean = false;
  private marketPumpBusy: boolean = false;
  private marketPumpTimer: number = -1;

  private getHostContext(): common.UIAbilityContext | undefined {
    return this.getUIContext().getHostContext() as common.UIAbilityContext | undefined;
  }

  aboutToAppear(): void {
    this.bridge.onRequestNotificationPermission = (): Promise<boolean> => this.requestNotificationPermission();
    this.bridge.onNotify = (title: string, body: string): Promise<boolean> => this.notify(title, body);
    this.bridge.onSaveTextFile = (fileName: string, contents: string): Promise<boolean> =>
      this.saveTextFile(fileName, contents);
    this.bridge.onFetchMarketText = (url: string, requestId: string): void => {
      void this.runMarketRequest(url, requestId);
    };
  }

  aboutToDisappear(): void {
    this.webReady = false;
    if (this.marketPumpTimer >= 0) {
      clearInterval(this.marketPumpTimer);
      this.marketPumpTimer = -1;
    }
  }

  async requestNotificationPermission(): Promise<boolean> {
    try {
      const context = this.getHostContext();
      if (!context) return false;
      if (!await notificationManager.isNotificationEnabled()) {
        await notificationManager.requestEnableNotification(context);
      }
      return await notificationManager.isNotificationEnabled();
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'notification permission failed: %{public}s', JSON.stringify(error));
      return false;
    }
  }

  async notify(title: string, body: string): Promise<boolean> {
    try {
      if (!await notificationManager.isNotificationEnabled()) return false;
      const content: notificationManager.NotificationContent = {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: {
          title: title || '简盯 · 提醒',
          text: body,
          additionalText: ''
        }
      };
      await notificationManager.publish({
        id: 40000 + Math.floor(Date.now() % 20000),
        content: content
      });
      return true;
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'notification publish failed: %{public}s', JSON.stringify(error));
      return false;
    }
  }

  async saveTextFile(fileName: string, contents: string): Promise<boolean> {
    try {
      const context = this.getHostContext();
      if (!context) return false;
      const documentPicker = new picker.DocumentViewPicker(context);
      const options = new picker.DocumentSaveOptions();
      options.newFileNames = [fileName || '简盯_策略回测.md'];
      options.fileSuffixChoices = ['Markdown 文档|.md'];
      const uris = await documentPicker.save(options);
      if (!uris.length) return false;
      const file = fileIo.openSync(
        uris[0],
        fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC
      );
      try {
        fileIo.writeSync(file.fd, contents);
      } finally {
        fileIo.closeSync(file);
      }
      hilog.info(DOMAIN, TAG, 'report saved: %{public}s', fileName);
      return true;
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'report save failed: %{public}s', JSON.stringify(error));
      return false;
    }
  }

  async fetchMarketText(url: string): Promise<string> {
    const allowedHosts: string[] = [
      'https://qt.gtimg.cn/',
      'https://web.ifzq.gtimg.cn/',
      'https://smartbox.gtimg.cn/',
      'https://fund.eastmoney.com/',
      'https://vip.stock.finance.sina.com.cn/'
    ];
    if (!allowedHosts.some((prefix: string) => url.startsWith(prefix))) {
      throw new Error('行情地址不在允许列表内');
    }
    hilog.info(DOMAIN, TAG, 'market request: %{public}s', url);
    const request = http.createHttp();
    try {
      const response = await request.request(url, {
        method: http.RequestMethod.GET,
        header: {
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          Referer: 'https://gu.qq.com/'
        },
        expectDataType: http.HttpDataType.STRING,
        usingCache: false,
        connectTimeout: 5000,
        readTimeout: 8000
      });
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new Error('行情请求失败: ' + response.responseCode);
      }
      if (typeof response.result !== 'string') {
        throw new Error('行情响应不是文本');
      }
      hilog.info(DOMAIN, TAG, 'market response: %{public}d bytes', response.result.length);
      return response.result;
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'market request failed: %{public}s', JSON.stringify(error));
      throw new Error('行情请求失败');
    } finally {
      try {
        request.destroy();
      } catch (error) {
        hilog.warn(DOMAIN, TAG, 'market request cleanup failed: %{public}s', JSON.stringify(error));
      }
    }
  }

  private emitMarketResponse(requestId: string, text: string, error: string): void {
    if (!this.webReady) return;
    const payload = JSON.stringify({ requestId, text, error });
    const script =
      `window.dispatchEvent(new CustomEvent('jianding:market-response',{detail:${payload}}));`;
    try {
      this.controller.runJavaScript(script).catch((reason: Error) => {
        hilog.warn(DOMAIN, TAG, 'market response dispatch failed: %{public}s', reason.message);
      });
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'market response dispatch exception: %{public}s', JSON.stringify(error));
    }
  }

  private async runMarketRequest(url: string, requestId: string): Promise<void> {
    try {
      const text = await this.fetchMarketText(url);
      this.emitMarketResponse(requestId, text, '');
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'market request failed: %{public}s', JSON.stringify(error));
      this.emitMarketResponse(requestId, '', '行情请求失败');
    }
  }

  private startMarketPump(): void {
    if (this.marketPumpTimer >= 0) return;
    this.marketPumpTimer = setInterval((): void => {
      void this.drainMarketRequests();
    }, 3000);
  }

  private async drainMarketRequests(): Promise<void> {
    if (!this.webReady || this.marketPumpBusy) return;
    this.marketPumpBusy = true;
    try {
      const raw = await this.controller.runJavaScript(
        '(() => { const root = document.documentElement; const raw = root.dataset.jiandingMarketRequests || "[]"; root.dataset.jiandingMarketRequests = "[]"; return raw; })()'
      );
      const encoded = JSON.parse(raw || '"[]"') as string;
      const requests = JSON.parse(encoded || '[]') as MarketRequestPayload[];
      if (!Array.isArray(requests)) return;
      if (requests.length > 0) {
        hilog.info(DOMAIN, TAG, 'market pump drained: %{public}d', requests.length);
      }
      for (const request of requests) {
        if (!request.requestId || !request.url) continue;
        void this.runMarketRequest(request.url, request.requestId);
      }
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'market pump failed: %{public}s', JSON.stringify(error));
    } finally {
      this.marketPumpBusy = false;
    }
  }

  onBackPress(): boolean {
    try {
      if (this.controller.accessStep(-1)) {
        this.controller.backward();
        return true;
      }
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'web back failed');
    }
    return false;
  }

  build() {
    Stack() {
      Web({ src: $rawfile('dist/index.html'), controller: this.controller })
        .width('100%')
        .height('100%')
        .cacheMode(CacheMode.None)
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .imageAccess(true)
        .zoomAccess(false)
        .fileAccess(false)
        .javaScriptProxy({
          object: this.bridge,
          name: 'JiandingNative',
          methodList: [
            'requestNotificationPermission',
            'notify',
            'saveTextFile',
            'fetchMarketText'
          ],
          asyncMethodList: [
            'requestNotificationPermission',
            'notify',
            'saveTextFile'
          ],
          controller: this.controller
        })
        .onPageBegin(() => {
          this.webReady = false;
        })
        .onPageEnd(() => {
          this.webReady = true;
          this.startMarketPump();
          void this.drainMarketRequests();
          hilog.info(DOMAIN, TAG, 'web content ready');
          this.controller.runJavaScript('Boolean(window.JiandingNative)')
            .then((available: string) => {
              hilog.info(DOMAIN, TAG, 'native bridge available: ' + available);
            })
            .catch((error: Error) => {
              hilog.warn(DOMAIN, TAG, 'native bridge probe failed: ' + error.message);
            });
        })
        .onConsole((event) => {
          if (!event) return false;
          const message = event.message.getMessage();
          hilog.info(DOMAIN, TAG, 'console: ' + message);
          if (message.includes('jianding:market-request')) {
            void this.drainMarketRequests();
          }
          return false;
        })
        .onErrorReceive((event) => {
          if (!event) return;
          const url = event.request ? event.request.getRequestUrl() : '(no request)';
          const info = event.error ? event.error.getErrorInfo() : '(no error)';
          hilog.error(DOMAIN, TAG, 'resource failed: ' + url + ' :: ' + info);
        })
        .onRenderExited(() => {
          hilog.error(DOMAIN, TAG, 'render process exited');
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F2F2F7')
  }
}
