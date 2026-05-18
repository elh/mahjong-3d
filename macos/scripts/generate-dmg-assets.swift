import AppKit
import Foundation

let rootURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let previewURL = rootURL.appendingPathComponent("public/social-preview.png")

try FileManager.default.createDirectory(
    at: outputURL,
    withIntermediateDirectories: true
)

guard let preview = NSImage(contentsOf: previewURL) else {
    fputs("Could not load \(previewURL.path)\n", stderr)
    exit(1)
}

func savePNG(_ image: NSImage, to url: URL) throws {
    guard
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(image.size.width),
            pixelsHigh: Int(image.size.height),
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ),
        let context = NSGraphicsContext(bitmapImageRep: bitmap)
    else {
        throw NSError(domain: "Mahjong3DAssets", code: 1)
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    image.draw(in: NSRect(origin: .zero, size: image.size))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "Mahjong3DAssets", code: 1)
    }
    try png.write(to: url)
}

func drawPreview(
    _ preview: NSImage,
    in rect: NSRect,
    cornerRadius: CGFloat,
    opacity: CGFloat = 1
) {
    NSGraphicsContext.current?.saveGraphicsState()
    NSBezierPath(roundedRect: rect, xRadius: cornerRadius, yRadius: cornerRadius)
        .addClip()

    let previewSize = preview.size
    let sourceAspect = previewSize.width / previewSize.height
    let targetAspect = rect.width / rect.height
    let sourceRect: NSRect
    if sourceAspect > targetAspect {
        let width = previewSize.height * targetAspect
        sourceRect = NSRect(
            x: (previewSize.width - width) / 2,
            y: 0,
            width: width,
            height: previewSize.height
        )
    } else {
        let height = previewSize.width / targetAspect
        sourceRect = NSRect(
            x: 0,
            y: (previewSize.height - height) / 2,
            width: previewSize.width,
            height: height
        )
    }
    preview.draw(
        in: rect,
        from: sourceRect,
        operation: .sourceOver,
        fraction: opacity
    )
    NSGraphicsContext.current?.restoreGraphicsState()
}

func makeBackground() -> NSImage {
    let size = NSSize(width: 720, height: 420)
    let image = NSImage(size: size)
    image.lockFocus()

    NSColor(calibratedRed: 13 / 255, green: 34 / 255, blue: 28 / 255, alpha: 1).setFill()
    NSRect(origin: .zero, size: size).fill()

    let vignette = NSGradient(colors: [
        NSColor(calibratedWhite: 0, alpha: 0),
        NSColor(calibratedWhite: 0, alpha: 0.34),
    ])
    vignette?.draw(
        in: NSRect(origin: .zero, size: size),
        relativeCenterPosition: NSPoint(x: 0.46, y: 0.1)
    )

    let titleStyle = NSMutableParagraphStyle()
    titleStyle.alignment = .left
    let titleAttributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 32, weight: .semibold),
        .foregroundColor: NSColor(calibratedWhite: 0.96, alpha: 1),
        .paragraphStyle: titleStyle,
    ]
    "Mahjong 3D".draw(
        in: NSRect(x: 66, y: 315, width: 270, height: 42),
        withAttributes: titleAttributes
    )

    let bodyAttributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 17, weight: .regular),
        .foregroundColor: NSColor(calibratedWhite: 0.88, alpha: 0.86),
        .paragraphStyle: titleStyle,
    ]
    "Taiwanese Mahjong screen saver".draw(
        in: NSRect(x: 68, y: 283, width: 320, height: 26),
        withAttributes: bodyAttributes
    )

    let installAttributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 17, weight: .semibold),
        .foregroundColor: NSColor(calibratedWhite: 0.98, alpha: 0.92),
        .paragraphStyle: titleStyle,
    ]
    "Double-click icon to install.".draw(
        in: NSRect(x: 68, y: 169, width: 330, height: 28),
        withAttributes: installAttributes
    )

    let footerAttributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 13, weight: .medium),
        .foregroundColor: NSColor(calibratedWhite: 0.82, alpha: 0.56),
        .paragraphStyle: titleStyle,
    ]
    "Select it in System Settings > Screen Saver".draw(
        in: NSRect(x: 68, y: 136, width: 420, height: 22),
        withAttributes: footerAttributes
    )

    let creditAttributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 12, weight: .medium),
        .foregroundColor: NSColor(calibratedWhite: 0.82, alpha: 0.48),
        .paragraphStyle: titleStyle,
    ]
    "by Eugene Huang - github.com/elh".draw(
        in: NSRect(x: 68, y: 95, width: 360, height: 20),
        withAttributes: creditAttributes
    )

    image.unlockFocus()
    return image
}

func makeIconSource() -> NSImage {
    let size = NSSize(width: 1024, height: 1024)
    let image = NSImage(size: size)
    image.lockFocus()

    NSColor.clear.setFill()
    NSRect(origin: .zero, size: size).fill()

    let outer = NSRect(x: 72, y: 72, width: 880, height: 880)
    NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.05, alpha: 1).setFill()
    NSBezierPath(roundedRect: outer, xRadius: 190, yRadius: 190).fill()

    drawPreview(
        preview,
        in: NSRect(x: 136, y: 260, width: 752, height: 470),
        cornerRadius: 70,
        opacity: 1
    )

    let markAttributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 128, weight: .semibold),
        .foregroundColor: NSColor(calibratedWhite: 0.96, alpha: 0.9),
    ]
    "Mahjong 3D".draw(
        in: NSRect(x: 0, y: 140, width: size.width, height: 150),
        withAttributes: markAttributes.merging([
            .paragraphStyle: {
                let style = NSMutableParagraphStyle()
                style.alignment = .center
                return style
            }(),
        ]) { current, _ in current }
    )

    image.unlockFocus()
    return image
}

func makeThumbnail(size: NSSize) -> NSImage {
    let image = NSImage(size: size)
    image.lockFocus()

    NSColor(calibratedRed: 13 / 255, green: 34 / 255, blue: 28 / 255, alpha: 1).setFill()
    NSRect(origin: .zero, size: size).fill()

    drawPreview(
        preview,
        in: NSRect(origin: .zero, size: size),
        cornerRadius: 0,
        opacity: 1
    )

    image.unlockFocus()
    return image
}

try savePNG(makeBackground(), to: outputURL.appendingPathComponent("dmg-background.png"))
let iconSource = makeIconSource()
try savePNG(iconSource, to: outputURL.appendingPathComponent("icon-source.png"))
try savePNG(makeThumbnail(size: NSSize(width: 90, height: 58)), to: outputURL.appendingPathComponent("thumbnail.png"))
try savePNG(
    makeThumbnail(size: NSSize(width: 180, height: 116)),
    to: outputURL.appendingPathComponent("thumbnail@2x.png")
)
