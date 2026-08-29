export type ChromeSidePanel = {
  setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
};

export async function configureSidePanel(sidePanel: ChromeSidePanel): Promise<void> {
  await sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

export const initializeSidePanel = configureSidePanel;
