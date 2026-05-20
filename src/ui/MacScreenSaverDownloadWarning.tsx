export const macScreenSaverDownloadWarning =
  "Only for macOS 15 Sequoia. Broken in macOS 26 Tahoe.";

export function MacScreenSaverDownloadWarningTooltip() {
  return (
    <span className="screensaver-download-tooltip" role="tooltip">
      Only for macOS 15 Sequoia ☹️
      <br />
      Broken in macOS 26 Tahoe
    </span>
  );
}
