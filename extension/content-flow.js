(function () {
  if (globalThis.__VF_CONTENT_FLOW__) return;
  globalThis.__VF_CONTENT_FLOW__ = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "VF_PING") {
      sendResponse({ ok: true, flowDom: !!globalThis.__VF_FLOW_DOM__, picker: !!globalThis.__VF_EDIT_PICKER__ });
      return true;
    }

    if (msg.type === "VF_BOOT_EDIT_PICKER") {
      globalThis.__VF_EDIT_PICKER_STARTED__ = false;
      void globalThis.__VF_EDIT_PICKER__?.bootPicker?.();
      globalThis.__VF_EDIT_PICKER__?.scanAndAttach?.();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type !== "VF_FILL_ON_PAGE") return;
    void (async () => {
      try {
        console.log("[Video Flow] VF_FILL_ON_PAGE received", {
          scene: msg.payload?.sceneNumber,
          autoRun: msg.flowSettings?.autoRun,
        });
        if (!globalThis.__VF_FLOW_DOM__) {
          throw new Error("flow-dom not loaded");
        }
        const result = await globalThis.__VF_FLOW_DOM__.fillGoogleFlowScene(
          msg.payload,
          msg.flowSettings ?? {}
        );
        console.log("[Video Flow] VF_FILL_ON_PAGE done", result);
        sendResponse({ ok: true, result });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        console.error("[Video Flow] VF_FILL_ON_PAGE error:", err, e);
        sendResponse({ ok: false, error: err });
      }
    })();
    return true;
  });
})();
