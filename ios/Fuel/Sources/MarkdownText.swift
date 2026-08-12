import SwiftUI

// Coach replies come back as markdown — every provider writes headings, bullet lists
// and **bold** whether or not it was asked to, and a remote model does it far more than
// the on-device one. SwiftUI's Text markdown support covers inline styling only, so a
// bulleted list rendered through it keeps its literal "- " and a heading its "###".
//
// This renders the block level (headings, bullets, numbered items, blank-line spacing)
// as stacked Text views and hands each line's inline styling to AttributedString, which
// already handles **bold**, *italic*, `code` and links correctly. Deliberately not a
// full CommonMark implementation: tables, block quotes, and fenced code blocks are more
// than a chat bubble needs, and a fenced block still reads fine as its literal lines.

struct MarkdownText: View {
    let text: String
    var color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(Self.blocks(from: text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let level, let content):
                    inline(content)
                        .font(.system(size: level == 1 ? 17 : level == 2 ? 16 : 15, weight: .semibold))
                case .bullet(let content, let depth):
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("•").font(.system(size: 15))
                        inline(content).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.leading, CGFloat(depth) * 12)
                case .numbered(let marker, let content, let depth):
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(marker).font(.system(size: 15, weight: .medium))
                        inline(content).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.leading, CGFloat(depth) * 12)
                case .paragraph(let content):
                    inline(content).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private func inline(_ content: String) -> Text {
        Text(Self.styled(content)).foregroundStyle(color)
    }

    /// Inline styling via AttributedString. `.inlineOnlyPreservingWhitespace` keeps the
    /// text as written when it isn't valid markdown, so a stray asterisk in prose never
    /// swallows the rest of the line; a parse failure falls back to the raw string.
    static func styled(_ content: String) -> AttributedString {
        (try? AttributedString(
            markdown: content,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(content)
    }

    enum Block {
        case heading(level: Int, content: String)
        case bullet(content: String, depth: Int)
        case numbered(marker: String, content: String, depth: Int)
        case paragraph(String)
    }

    /// Splits into block elements. Consecutive plain lines join into one paragraph so
    /// hard-wrapped prose doesn't render as a stack of one-line fragments.
    static func blocks(from text: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []

        func flush() {
            let joined = paragraph.joined(separator: " ").trimmingCharacters(in: .whitespaces)
            if !joined.isEmpty { blocks.append(.paragraph(joined)) }
            paragraph = []
        }

        for rawLine in text.components(separatedBy: .newlines) {
            let indent = rawLine.prefix { $0 == " " || $0 == "\t" }.count
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            let depth = min(indent / 2, 3)

            if line.isEmpty { flush(); continue }

            if let hashes = line.range(of: "^#{1,6}\\s+", options: .regularExpression) {
                flush()
                let level = line.distance(from: line.startIndex, to: hashes.upperBound)
                    - line[hashes].filter { $0 == " " }.count
                blocks.append(.heading(level: min(level, 3), content: String(line[hashes.upperBound...])))
                continue
            }
            // A horizontal rule is a divider in prose; dropping it beats rendering "---".
            if line.range(of: "^(-{3,}|\\*{3,}|_{3,})$", options: .regularExpression) != nil {
                flush(); continue
            }
            if let marker = line.range(of: "^[-*+]\\s+", options: .regularExpression) {
                flush()
                blocks.append(.bullet(content: String(line[marker.upperBound...]), depth: depth))
                continue
            }
            if let marker = line.range(of: "^\\d+[.)]\\s+", options: .regularExpression) {
                flush()
                blocks.append(.numbered(marker: line[marker].trimmingCharacters(in: .whitespaces),
                                        content: String(line[marker.upperBound...]), depth: depth))
                continue
            }
            paragraph.append(line)
        }
        flush()
        return blocks
    }
}
