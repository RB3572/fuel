import SwiftUI
import UIKit

// A horizontal drag that a scroll view can still scroll through.
//
// SwiftUI's own DragGesture cannot do this. Inside a ScrollView it competes with the
// scroll pan and wins as soon as it passes its minimum distance, in whatever direction
// the finger went — so a row carrying one becomes a dead zone where the page will not
// scroll at all. `.simultaneousGesture` does not help: it governs how this gesture
// composes with other SwiftUI gestures, not whether the scroll view is allowed to keep
// the touch, and the drag still claims it. Filtering by direction inside `onChanged` is
// too late, because by then the gesture has already been recognised.
//
// A UIKit pan recognizer can decline the touch outright. `gestureRecognizerShouldBegin`
// is consulted before recognition, so answering "no" to a mostly-vertical drag leaves
// that touch entirely to the scroll view, exactly as if this gesture were not attached.

/// Reports horizontal drags only, in points, leaving vertical ones to the enclosing
/// scroll view. `onEnded` also receives where the drag would land at its release
/// velocity, which is what makes a quick flick feel decisive rather than requiring a
/// full deliberate drag.
struct HorizontalPan: UIGestureRecognizerRepresentable {
    var onChanged: (CGFloat) -> Void
    var onEnded: (_ translation: CGFloat, _ predictedTranslation: CGFloat) -> Void

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let recognizer = UIPanGestureRecognizer()
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let translation = recognizer.translation(in: recognizer.view).x
        switch recognizer.state {
        case .changed:
            onChanged(translation)
        case .ended, .cancelled, .failed:
            // A quarter second of travel at the release velocity — the same horizon
            // UIKit's own decelerating scroll views use for a flick.
            let velocity = recognizer.velocity(in: recognizer.view).x
            onEnded(translation, translation + velocity * 0.25)
        default:
            break
        }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        /// The whole point: a drag that is mostly vertical is declined here, before it
        /// is ever recognised, so the scroll view keeps the touch and the page scrolls.
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
            let velocity = pan.velocity(in: pan.view)
            return abs(velocity.x) > abs(velocity.y)
        }

        /// Only ever reached for drags this already judged horizontal, where letting the
        /// scroll view continue to observe costs nothing — it has no horizontal axis to
        /// move on.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}
