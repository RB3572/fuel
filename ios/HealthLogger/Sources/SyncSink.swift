import Foundation

// Where a sync pass sends its batches.
//
// The collection side of the engine — anchored queries, paging, daily aggregates — is
// identical whether the destination is Fuel, somebody else's server, or a file on the
// phone. Only the sink differs, so the engine takes one of these and stays ignorant of
// the difference. Adding a third destination means writing one more conformer.

protocol SyncSink: AnyObject, Sendable {
    /// Batches the destination has already seen, keyed by data type. A server can hand
    /// back its anchor mirror so a reinstall resumes; a file export has no memory.
    func knownAnchors() async -> [String: String]

    func send(_ payload: SyncPayload) async throws

    /// Whether a successful send should move the local anchors forward. An export must
    /// not: it reads the whole history every time and would otherwise convince the app
    /// that Fuel has data it never received.
    var advancesAnchors: Bool { get }
}

/// Uploads to a server speaking the /api/health/sync/v1 protocol — Fuel by default,
/// or anything else that implements the same contract (see HEALTH_SYNC.md).
final class ServerSink: SyncSink, @unchecked Sendable {
    private let api: FuelAPI
    init(api: FuelAPI) { self.api = api }

    var advancesAnchors: Bool { true }

    func knownAnchors() async -> [String: String] {
        (try? await api.state())?.anchors ?? [:]
    }

    func send(_ payload: SyncPayload) async throws {
        _ = try await api.upload(payload)
    }
}

/// Writes the export to a file instead of a server: one JSON batch per line (NDJSON),
/// each line byte-identical to what would have been POSTed. That keeps the export
/// streaming — a decade of samples never has to fit in memory — and makes it directly
/// replayable: `while read -r line; do curl -d "$line" …; done < export.ndjson`.
final class FileExportSink: SyncSink, @unchecked Sendable {
    let url: URL
    private let handle: FileHandle
    private let encoder = JSONEncoder()
    private(set) var batches = 0

    init() throws {
        let stamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        url = FileManager.default.temporaryDirectory
            .appendingPathComponent("health-export-\(stamp).ndjson")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = try FileHandle(forWritingTo: url)
    }

    var advancesAnchors: Bool { false }
    func knownAnchors() async -> [String: String] { [:] }

    func send(_ payload: SyncPayload) async throws {
        var line = try encoder.encode(payload)
        line.append(0x0A)
        try handle.write(contentsOf: line)
        batches += 1
    }

    func finish() { try? handle.close() }
}
