const FLOW_SETTINGS_KEY = "flowSettings";

export const DEFAULT_FLOW_SETTINGS = {
  autoRun: true,
  autoPipeline: true,
  aspectRatio: "9:16",
  model: "Veo 3.1",
  videoMode: "Frames to Video",
  duration: "8",
  outputs: "1",
};

export async function getFlowSettings() {
  const data = await chrome.storage.sync.get(FLOW_SETTINGS_KEY);
  return { ...DEFAULT_FLOW_SETTINGS, ...(data[FLOW_SETTINGS_KEY] ?? {}) };
}

export async function setFlowSettings(partial) {
  const current = await getFlowSettings();
  await chrome.storage.sync.set({
    [FLOW_SETTINGS_KEY]: { ...current, ...partial },
  });
}
