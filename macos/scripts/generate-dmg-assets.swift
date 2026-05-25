import AppKit
import Foundation

let rootURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let previewURL = rootURL.appendingPathComponent("public/social-preview.png")
let icnsEntries: [(type: String, pixels: CGFloat)] = [
    ("icp4", 16),
    ("icp5", 32),
    ("icp6", 64),
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
    ("ic11", 32),
    ("ic12", 64),
    ("ic13", 256),
    ("ic14", 512),
]

try FileManager.default.createDirectory(
    at: outputURL,
    withIntermediateDirectories: true
)

guard let preview = NSImage(contentsOf: previewURL) else {
    fputs("Could not load \(previewURL.path)\n", stderr)
    exit(1)
}

func pngData(_ image: NSImage) throws -> Data {
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
    return png
}

func savePNG(_ image: NSImage, to url: URL) throws {
    let png = try pngData(image)
    try png.write(to: url)
}

func saveTIFF(_ image: NSImage, to url: URL) throws {
    guard let tiff = image.tiffRepresentation else {
        throw NSError(domain: "Mahjong3DAssets", code: 1)
    }
    try tiff.write(to: url)
}

func appendBigEndianUInt32(_ value: UInt32, to data: inout Data) {
    var bigEndianValue = value.bigEndian
    withUnsafeBytes(of: &bigEndianValue) { bytes in
        data.append(contentsOf: bytes)
    }
}

func saveICNS(
    imageFactory: (NSSize) -> NSImage,
    to url: URL
) throws {
    var body = Data()
    for entry in icnsEntries {
        let size = NSSize(width: entry.pixels, height: entry.pixels)
        let png = try pngData(imageFactory(size))
        guard let typeData = entry.type.data(using: .ascii), typeData.count == 4 else {
            throw NSError(domain: "Mahjong3DAssets", code: 1)
        }
        body.append(typeData)
        appendBigEndianUInt32(UInt32(png.count + 8), to: &body)
        body.append(png)
    }

    var icns = Data()
    icns.append("icns".data(using: .ascii)!)
    appendBigEndianUInt32(UInt32(body.count + 8), to: &icns)
    icns.append(body)
    try icns.write(to: url)
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

func drawPreviewAspectFit(
    _ preview: NSImage,
    in rect: NSRect,
    cornerRadius: CGFloat
) {
    NSGraphicsContext.current?.saveGraphicsState()
    NSBezierPath(roundedRect: rect, xRadius: cornerRadius, yRadius: cornerRadius)
        .addClip()

    let previewSize = preview.size
    let sourceAspect = previewSize.width / previewSize.height
    let targetAspect = rect.width / rect.height
    let drawRect: NSRect
    if sourceAspect > targetAspect {
        let height = rect.width / sourceAspect
        drawRect = NSRect(
            x: rect.minX,
            y: rect.minY + (rect.height - height) / 2,
            width: rect.width,
            height: height
        )
    } else {
        let width = rect.height * sourceAspect
        drawRect = NSRect(
            x: rect.minX + (rect.width - width) / 2,
            y: rect.minY,
            width: width,
            height: rect.height
        )
    }
    preview.draw(
        in: drawRect,
        from: NSRect(origin: .zero, size: previewSize),
        operation: .sourceOver,
        fraction: 1
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

func makeAppIcon(size: NSSize) -> NSImage {
    let image = NSImage(size: size)
    image.lockFocus()

    NSColor.clear.setFill()
    NSRect(origin: .zero, size: size).fill()

    let bounds = NSRect(origin: .zero, size: size)
    let cornerRadius = size.width * 0.22
    let background = NSBezierPath(roundedRect: bounds, xRadius: cornerRadius, yRadius: cornerRadius)
    NSColor(calibratedRed: 13 / 255, green: 34 / 255, blue: 28 / 255, alpha: 1).setFill()
    background.fill()

    NSColor(calibratedWhite: 1, alpha: 0.16).setStroke()
    background.lineWidth = max(1, size.width * 0.012)
    background.stroke()

    let fontSize = size.width * 0.68
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont(name: "Apple Color Emoji", size: fontSize) ?? NSFont.systemFont(ofSize: fontSize),
    ]
    let text = NSAttributedString(string: "🀄", attributes: attributes)
    let textSize = text.size()
    text.draw(
        at: NSPoint(
            x: (size.width - textSize.width) / 2,
            y: (size.height - textSize.height) / 2 - size.height * 0.035
        )
    )

    image.unlockFocus()
    return image
}

func makeScreenSaverIcon(size: NSSize) -> NSImage {
    let image = NSImage(size: size)
    image.lockFocus()

    NSColor.clear.setFill()
    NSRect(origin: .zero, size: size).fill()

    let bounds = NSRect(origin: .zero, size: size)
    let cornerRadius = size.width * 0.2
    let background = NSBezierPath(roundedRect: bounds, xRadius: cornerRadius, yRadius: cornerRadius)
    NSColor(calibratedRed: 13 / 255, green: 34 / 255, blue: 28 / 255, alpha: 1).setFill()
    background.fill()

    let previewWidth = size.width * 0.88
    let previewHeight = previewWidth * (1260.0 / 2400.0)
    let previewRect = NSRect(
        x: (size.width - previewWidth) / 2,
        y: (size.height - previewHeight) / 2,
        width: previewWidth,
        height: previewHeight
    )
    drawPreviewAspectFit(preview, in: previewRect, cornerRadius: size.width * 0.055)

    image.unlockFocus()
    return image
}

try savePNG(makeThumbnail(size: NSSize(width: 90, height: 58)), to: outputURL.appendingPathComponent("thumbnail.png"))
try savePNG(
    makeThumbnail(size: NSSize(width: 180, height: 116)),
    to: outputURL.appendingPathComponent("thumbnail@2x.png")
)
try saveTIFF(makeThumbnail(size: NSSize(width: 180, height: 116)), to: outputURL.appendingPathComponent("thumbnail.tiff"))
try saveICNS(imageFactory: makeAppIcon, to: outputURL.appendingPathComponent("Mahjong3D.icns"))
try saveICNS(imageFactory: makeScreenSaverIcon, to: outputURL.appendingPathComponent("screen-saver-icon.icns"))
