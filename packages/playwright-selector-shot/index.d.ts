export type SelectorShotOptions = {
  outDir?: string;
  selectorMarker?: string;
  maxPerTest?: number;
  captureStrategy?: "afterEach" | "onUse" | "hybrid";
  captureTimeoutMs?: number;
  preCaptureWaitMs?: number;
  captureRetries?: number;
  retryDelayMs?: number;
  maxAfterEachMs?: number;
  skipMissingSelectors?: boolean;
  missingSelectorTimeoutMs?: number;
  debugCapture?: boolean;
  debugConsole?: boolean;
};

export declare function selectorShot(options?: SelectorShotOptions): {
  beforeEach: (args: { page: any }, testInfo: any) => Promise<void>;
  afterEach: (args: { page: any }, testInfo: any) => Promise<void>;
};

export declare function installSelectorShot(test: any, options?: SelectorShotOptions): void;
export declare function wireSelectorShot(test: any, options?: SelectorShotOptions): void;
