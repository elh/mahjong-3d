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

try savePNG(makeThumbnail(size: NSSize(width: 107, height: 65)), to: outputURL.appendingPathComponent("thumbnail.png"))
try savePNG(
    makeThumbnail(size: NSSize(width: 214, height: 130)),
    to: outputURL.appendingPathComponent("thumbnail@2x.png")
)
