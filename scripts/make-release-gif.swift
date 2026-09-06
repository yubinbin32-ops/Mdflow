import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count >= 4 else {
    fputs("usage: swift make-release-gif.swift frame1.png frame2.png output.gif\n", stderr)
    exit(2)
}

let frameURLs = CommandLine.arguments.dropFirst().dropLast().map { URL(fileURLWithPath: $0) }
let outputURL = URL(fileURLWithPath: CommandLine.arguments.last!)
guard let destination = CGImageDestinationCreateWithURL(
    outputURL as CFURL,
    UTType.gif.identifier as CFString,
    frameURLs.count,
    nil
) else {
    fputs("could not create GIF destination\n", stderr)
    exit(1)
}

let gifProperties: [CFString: Any] = [
    kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]
]
CGImageDestinationSetProperties(destination, gifProperties as CFDictionary)

let frameProperties: [CFString: Any] = [
    kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1.8]
]
for frameURL in frameURLs {
    guard let source = CGImageSourceCreateWithURL(frameURL as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fputs("could not read \(frameURL.path)\n", stderr)
        exit(1)
    }
    CGImageDestinationAddImage(destination, image, frameProperties as CFDictionary)
}

guard CGImageDestinationFinalize(destination) else {
    fputs("could not finalize GIF\n", stderr)
    exit(1)
}
