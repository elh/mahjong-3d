import AppKit
import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Mahjong 3D")
                    .font(.largeTitle.weight(.semibold))
                Text("Screen Saver Extension")
                    .foregroundStyle(.secondary)
            }

            Divider()

            Text("Mahjong 3D installs as a macOS screen saver. Set it in System Settings > Wallpaper > Screen Saver...")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                openScreenSaverSettings()
            } label: {
                Label("Screen Saver Settings", systemImage: "gear")
            }
        }
        .padding(24)
        .frame(width: 440)
    }

    private func openScreenSaverSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }
}
