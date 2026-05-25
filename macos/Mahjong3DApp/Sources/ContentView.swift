import AppKit
import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .frame(width: 56, height: 56)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Mahjong 3D")
                        .font(.largeTitle.weight(.semibold))
                    Text("Screen Saver Extension")
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            Text("Mahjong 3D installs as a macOS screen saver. Open Screen Saver Settings to select it.")
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
