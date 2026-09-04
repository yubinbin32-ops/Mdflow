import SwiftUI

enum MdflowTheme {
    static let canvas = Color(red: 0.965, green: 0.969, blue: 0.976)
    static let surface = Color.white
    static let ink = Color(red: 0.067, green: 0.075, blue: 0.094)
    static let muted = Color(red: 0.451, green: 0.475, blue: 0.510)
    static let hairline = Color(red: 0.867, green: 0.882, blue: 0.906)
    static let focus = Color(red: 0.184, green: 0.420, blue: 1.0)
    static let success = Color(red: 0.098, green: 0.529, blue: 0.329)
    static let pending = Color(red: 0.769, green: 0.478, blue: 0.0)
    static let failure = Color(red: 0.820, green: 0.247, blue: 0.247)
    static let unstable = Color(red: 0.545, green: 0.290, blue: 0.796)

    static func healthColor(_ state: String) -> Color {
        switch state {
        case "healthy": success
        case "warning": pending
        case "failing": failure
        case "unstable", "disputed": unstable
        default: muted.opacity(0.55)
        }
    }

    static func deliveryColor(_ state: String) -> Color {
        switch state {
        case "complete": success
        case "implementing": focus
        case "verifying": pending
        case "deprecated": muted.opacity(0.35)
        case "planned": Color(red: 0.38, green: 0.42, blue: 0.55)
        default: muted.opacity(0.6)
        }
    }

    static func planColor(_ status: String) -> Color {
        switch status {
        case "complete": success
        case "active": focus
        case "verifying", "ready": pending
        case "blocked": failure
        case "cancelled": muted.opacity(0.35)
        default: muted.opacity(0.65)
        }
    }

    static let chainPalette: [Color] = [
        focus,
        Color(red: 0.92, green: 0.43, blue: 0.16),
        success,
        Color(red: 0.48, green: 0.30, blue: 0.86),
        failure,
        Color(red: 0.04, green: 0.55, blue: 0.62),
        Color(red: 0.74, green: 0.20, blue: 0.48),
        Color(red: 0.48, green: 0.34, blue: 0.18),
        Color(red: 0.24, green: 0.36, blue: 0.70),
        Color(red: 0.44, green: 0.58, blue: 0.06),
        Color(red: 0.00, green: 0.48, blue: 0.78),
        Color(red: 0.86, green: 0.30, blue: 0.58),
    ]

    static func chainColor(index: Int) -> Color {
        chainPalette[index % chainPalette.count]
    }

    static func blockKindColor(_ kind: String) -> Color {
        switch kind {
        case "ui", "flow": Color(red: 0.19, green: 0.43, blue: 0.92)
        case "service": Color(red: 0.08, green: 0.55, blue: 0.36)
        case "function": Color(red: 0.06, green: 0.48, blue: 0.62)
        case "integration": Color(red: 0.43, green: 0.32, blue: 0.78)
        case "data": Color(red: 0.88, green: 0.42, blue: 0.14)
        case "database": Color(red: 0.69, green: 0.28, blue: 0.66)
        case "test", "checkpoint": Color(red: 0.18, green: 0.46, blue: 0.82)
        case "risk": failure
        case "principle", "decision", "requirement", "product": Color(red: 0.45, green: 0.34, blue: 0.17)
        default: muted
        }
    }
}
