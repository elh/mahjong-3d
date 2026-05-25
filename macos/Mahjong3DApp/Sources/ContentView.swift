import AppKit
import SwiftUI

private let logger = Mahjong3DLog.logger("HostApp")

struct ContentView: View {
    @StateObject private var pluginManager = PluginManager()
    @State private var statusMessage = "Ready"

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

            GroupBox("Extension Status") {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Circle()
                            .fill(pluginManager.isInstalled ? Color.green : Color.gray)
                            .frame(width: 10, height: 10)
                        Text(pluginManager.isInstalled ? "Registered" : "Not Registered")
                            .fontWeight(.medium)
                        if let version = pluginManager.installedVersion {
                            Text("v\(version)")
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if pluginManager.isLoading {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }

                    if let path = pluginManager.installedPath {
                        labeledValue("Path", path)
                    } else if let version = pluginManager.embeddedVersion {
                        labeledValue("Embedded", "v\(version)")
                    }

                    if let error = pluginManager.lastError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
                .padding(6)
            }

            HStack(spacing: 10) {
                Button {
                    refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }

                Button {
                    install()
                } label: {
                    Label("Register", systemImage: "plus.circle")
                }
                .disabled(pluginManager.isLoading)

                Button {
                    uninstall()
                } label: {
                    Label("Unregister", systemImage: "minus.circle")
                }
                .disabled(pluginManager.isLoading || !pluginManager.isInstalled)

                Button {
                    openScreenSaverSettings()
                } label: {
                    Label("Screen Saver Settings", systemImage: "gear")
                }
            }

            Text(statusMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(24)
        .frame(width: 560)
    }

    private func labeledValue(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text("\(label):")
                .foregroundStyle(.secondary)
                .frame(width: 72, alignment: .leading)
            Text(value)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
        .font(.caption)
    }

    private func refresh() {
        statusMessage = "Refreshing status..."
        pluginManager.refresh()
        statusMessage = "Status refreshed"
    }

    private func install() {
        statusMessage = "Registering extension..."
        do {
            try pluginManager.install()
            statusMessage = "Extension registered"
        } catch {
            statusMessage = "Registration failed: \(error.localizedDescription)"
            Mahjong3DLog.error(logger, "Registration failed: \(error.localizedDescription)")
        }
    }

    private func uninstall() {
        statusMessage = "Unregistering extension..."
        do {
            try pluginManager.uninstall()
            statusMessage = "Extension unregistered"
        } catch {
            statusMessage = "Unregister failed: \(error.localizedDescription)"
            Mahjong3DLog.error(logger, "Unregister failed: \(error.localizedDescription)")
        }
    }

    private func openScreenSaverSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }
}
