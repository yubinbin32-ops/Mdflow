import SwiftUI

struct DetailView: View {
    @ObservedObject var store: GraphStore
    let selection: GraphSelection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Text(store.title(for: selection))
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .foregroundStyle(MdflowTheme.ink)
                entityContent
                checkpointSection
                historySection
            }
            .padding(24)
        }
        .background(MdflowTheme.surface)
    }

    @ViewBuilder
    private var entityContent: some View {
        switch selection.type {
        case .block:
            if let block = store.snapshot.blocks.first(where: { $0.id == selection.id }) {
                section(store.text("contract").uppercased(), text: store.blockText(block, field: "contract"))
                sourceSection(block.id)
            }
        case .chain:
            if let chain = store.snapshot.chains.first(where: { $0.id == selection.id }) {
                let contract = [
                    chain.inputContract.isEmpty ? nil : "\(store.text("input")) — \(store.chainText(chain, field: "inputContract"))",
                    chain.outputContract.isEmpty ? nil : "\(store.text("output")) — \(store.chainText(chain, field: "outputContract"))",
                ].compactMap { $0 }.joined(separator: "\n\n")
                section(store.text("contract").uppercased(), text: contract)
            }
        case .link:
            if let link = store.snapshot.links.first(where: { $0.id == selection.id }) {
                section(store.text("contract").uppercased(), text: store.localized(type: "link", id: link.id, field: "contract", fallback: link.contract))
            }
        case .plan:
            if let plan = store.snapshot.plans.first(where: { $0.id == selection.id }) {
                section(store.text("goal").uppercased(), text: store.planText(plan, field: "goal"))
                section(store.text("nextAction").uppercased(), text: store.planText(plan, field: "nextAction"))
                if !store.targetChains(for: plan.id).isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        sectionLabel(store.text("targetChains").uppercased())
                        ForEach(store.targetChains(for: plan.id)) { chain in
                            Button { store.select(GraphSelection(type: .chain, id: chain.id)) } label: {
                                HStack {
                                    Circle().fill(MdflowTheme.deliveryColor(chain.deliveryState)).frame(width: 7, height: 7)
                                    Text(store.chainText(chain, field: "title"))
                                    Spacer()
                                    Image(systemName: "scope")
                                }
                                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                                .foregroundStyle(MdflowTheme.ink)
                                .padding(10)
                                .background(MdflowTheme.canvas, in: RoundedRectangle(cornerRadius: 9))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                section(store.text("proposedDelta").uppercased(), text: prettyJSON(plan.proposedDelta))
                section(store.text("blockers").uppercased(), text: prettyJSON(plan.blockers))
            }
        }
    }

    @ViewBuilder
    private func section(_ title: String, text: String) -> some View {
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                sectionLabel(title)
                Text(text)
                    .font(.system(size: 12.5, weight: .regular, design: .rounded))
                    .foregroundStyle(MdflowTheme.ink.opacity(0.86))
                    .lineSpacing(4)
                    .textSelection(.enabled)
            }
        }
    }

    @ViewBuilder
    private func sourceSection(_ blockID: String) -> some View {
        let sources = store.sourceReferences(for: blockID)
        if !sources.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                sectionLabel(store.text("files").uppercased())
                ForEach(sources) { source in
                    Button {
                        store.revealSource(source)
                    } label: {
                        HStack(alignment: .top, spacing: 9) {
                            Image(systemName: "doc.text")
                                .font(.system(size: 11, weight: .medium))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(source.path + (source.startLine.map { ":\($0)" } ?? ""))
                                    .lineLimit(2)
                                Text(source.symbol ?? source.role)
                                    .foregroundStyle(MdflowTheme.muted)
                            }
                            Spacer()
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(MdflowTheme.ink)
                        .padding(11)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(MdflowTheme.canvas)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private var checkpointSection: some View {
        let checkpoints = store.checkpoints(for: selection)
        if !checkpoints.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                sectionLabel(store.text("checkpoints").uppercased())
                ForEach(checkpoints) { checkpoint in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 7) {
                            if !checkpoint.criteria.isEmpty { Text(checkpoint.criteria) }
                            if checkpoint.evidence != "[]" { Text(checkpoint.evidence).textSelection(.enabled) }
                        }
                        .font(.system(size: 11.5, design: .rounded))
                        .foregroundStyle(MdflowTheme.muted)
                        .padding(.top, 7)
                    } label: {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(checkpointColor(checkpoint.status))
                                .frame(width: 7, height: 7)
                            Text(checkpoint.title)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var historySection: some View {
        let history = store.history(for: selection)
        if !history.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                sectionLabel(store.text("history").uppercased())
                ForEach(history.prefix(12)) { item in
                    HStack(alignment: .top, spacing: 10) {
                        Text("r\(item.revision)")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundStyle(MdflowTheme.muted)
                            .frame(width: 28, alignment: .leading)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.summary)
                                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                                .foregroundStyle(MdflowTheme.ink)
                            Text(item.action.uppercased())
                                .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                                .tracking(1)
                                .foregroundStyle(MdflowTheme.muted)
                        }
                    }
                }
            }
        }
    }

    private func sectionLabel(_ value: String) -> some View {
        Text(value)
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(1.4)
            .foregroundStyle(MdflowTheme.muted)
    }

    private func checkpointColor(_ status: String) -> Color {
        switch status {
        case "passed": MdflowTheme.success
        case "failed": MdflowTheme.failure
        case "blocked": MdflowTheme.unstable
        default: MdflowTheme.pending
        }
    }

    private func prettyJSON(_ value: String) -> String {
        guard let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let formatted = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted]),
              let string = String(data: formatted, encoding: .utf8)
        else { return value == "[]" ? "" : value }
        return value == "[]" ? "" : string
    }
}
