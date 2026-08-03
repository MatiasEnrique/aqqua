import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
  fatalError("Usage: render-macos-tahoe-icon.swift <app-path> <output-png>")
}

let appPath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
NSAppearance.current = NSAppearance(named: .aqua)
let icon = NSWorkspace.shared.icon(forFile: appPath)
icon.size = NSSize(width: 1024, height: 1024)

guard
  let tiff = icon.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiff),
  let png = bitmap.representation(using: .png, properties: [:])
else {
  fatalError("Could not render the macOS app icon at \(appPath)")
}

try png.write(to: URL(fileURLWithPath: outputPath))
