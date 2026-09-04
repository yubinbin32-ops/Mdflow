import SwiftUI

struct DetailView: View {
    @ObservedObject var store: GraphStore
    let selection: GraphSelection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HStack(alignment: .top) {
                    Text(store.title(for: selection))
                        .font(.system(size: 18, weight: .semibold, design: .rounded))
                        .foregroundStyle(MdflowTheme.ink)
                    Spacer()
                    Button { store.requestFocus(selection) } label: {
                        Label(store.text("focusMode"), systemImage: "scope")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                entityContent
                revisionSection
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
                HStack(spacing: 8) {
                    metadataPill(block.architectureLayer)
                    metadataPill(block.scope)
                    if block.localOrder != 0 { metadataPill("#\(block.localOrder)") }
                }
                section(store.text("summary").uppercased(), text: store.blockText(block, field: "summary"))
                section(store.text("details").uppercased(), text: store.blockText(block, field: "body"))
                section(store.text("contract").uppercased(), text: store.blockText(block, field: "contract"))
                chainMembershipSection(block.id)
                relationSection(store.text("upstream").uppercased(), links: store.incomingLinks(for: block.id), blockID: block.id)
                relationSection(store.text("downstream").uppercased(), links: store.outgoingLinks(for: block.id), blockID: block.id)
                relatedPlanSection(block.id)
                sourceSection(block.id)
            }
        case .chain:
            if let chain = store.snapshot.chains.first(where: { $0.id == selection.id }) {
                section(store.text("summary").uppercased(), text: store.chainText(chain, field: "intent"))
                let contract = [
                    chain.inputContract.isEmpty ? nil : "\(store.text("input")) — \(store.chainText(chain, field: "inputContract"))",
                    chain.outputContract.isEmpty ? nil : "\(store.text("output")) — \(store.chainText(chain, field: "outputContract"))",
                ].compactMap { $0 }.joined(separator: "\n\n")
                section(store.text("contract").uppercased(), text: contract)
                chainPathSection(chain.id)
            }
        case .link:
            if let link = store.snapshot.links.first(where: { $0.id == selection.id }) {
                linkEndpointsSection(link)
                section(store.text("contract").uppercased(), text: store.localized(type: "link", id: link.id, field: "contract", fallback: link.contract))
            }
        case .plan:
            if let plan = store.snapshot.plans.first(where: { $0.id == selection.id }) {
                section(store.text("summary").uppercased(), text: store.planText(plan, field: "summary"))
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
                structuredList(store.text("proposedDelta").uppercased(), value: plan.proposedDelta)
                structuredList(store.text("blockers").uppercased(), value: plan.blockers)
            }
        }
    }

    private func metadataPill(_ value: String) -> some View {
        Text(value.uppercased())
            .font(.system(size: 8, weight: .bold, design: .monospaced))
            .tracking(0.7)
            .foregroundStyle(MdflowTheme.muted)
            .padding(.horizontal, 7)
            .frame(height: 22)
            .background(MdflowTheme.canvas, in: Capsule())
    }

    @ViewBuilder
    private func chainMembershipSection(_ blockID: String) -> some View {
        let chains = store.chains(containing: blockID)
        if !chains.isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                sectionLabel(store.text("memberships").uppercased())
                ForEach(chains) { chain in
                    let position = store.chainPosition(chain.id, blockID: blockID)
                    Button { store.select(GraphSelection(type: .chain, id: chain.id)) } label: {
                        HStack(spacing: 9) {
                            Circle().fill(store.chainColor(chain.id)).frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(store.chainText(chain, field: "title"))
                                Text("\((position?.index ?? 0) + 1) / \(position?.count ?? 0) · \(chain.deliveryState.uppercased())")
                                    .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                                    .foregroundStyle(MdflowTheme.muted)
                            }
                            Spacer()
                            Image(systemName: "arrow.right")
                        }
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(MdflowTheme.ink)
                        .padding(10)
                        .background(MdflowTheme.canvas, in: RoundedRectangle(cornerRadius: 9))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(store.chainText(chain, field: "title")), step \((position?.index ?? 0) + 1) of \(position?.count ?? 0)")
                }
            }
        }
    }

    @ViewBuilder
    private func relationSection(_ title: String, links: [LinkItem], blockID: String) -> some View {
        if !links.isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                sectionLabel(title)
                ForEach(links) { link in
                    let otherID = link.sourceId == blockID ? link.targetId : link.sourceId
                    Button { store.select(GraphSelection(type: .link, id: link.id)) } label: {
                        HStack(alignment: .top, spacing: 9) {
                            Image(systemName: link.sourceId == blockID ? "arrow.right" : "arrow.left")
                                .foregroundStyle(MdflowTheme.healthColor(link.healthState))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(store.block(otherID).map { store.blockText($0, field: "title") } ?? otherID)
                                Text((link.label.isEmpty ? link.kind : link.label).uppercased())
                                    .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                                    .foregroundStyle(MdflowTheme.muted)
                            }
                            Spacer()
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
    }

    @ViewBuilder
    private func relatedPlanSection(_ blockID: String) -> some View {
        let plans = store.plans(containing: blockID)
        if !plans.isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                sectionLabel(store.text("relatedPlans").uppercased())
                ForEach(plans) { plan in
                    Button { store.select(GraphSelection(type: .plan, id: plan.id)) } label: {
                        HStack {
                            Circle().fill(MdflowTheme.planColor(plan.status)).frame(width: 7, height: 7)
                            Text(store.planText(plan, field: "title")).lineLimit(2)
                            Spacer()
                            Text(plan.status.uppercased())
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                                .foregroundStyle(MdflowTheme.planColor(plan.status))
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
    }

    @ViewBuilder
    private func chainPathSection(_ chainID: String) -> some View {
        let nodeIDs = store.chainNodeIDs(chainID)
        if !nodeIDs.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                sectionLabel(store.text("path").uppercased())
                ForEach(Array(nodeIDs.enumerated()), id: \.element) { index, id in
                    Button { store.select(GraphSelection(type: .block, id: id)) } label: {
                        HStack(spacing: 9) {
                            Text("\(index + 1)")
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundStyle(store.chainColor(chainID))
                                .frame(width: 18, height: 18)
                                .background(store.chainColor(chainID).opacity(0.1), in: Circle())
                            Text(store.block(id).map { store.blockText($0, field: "title") } ?? id)
                            Spacer()
                            if index < nodeIDs.count - 1 { Image(systemName: "arrow.down") }
                        }
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(MdflowTheme.ink)
                        .padding(.vertical, 5)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func linkEndpointsSection(_ link: LinkItem) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            sectionLabel(store.text("link").uppercased())
            HStack(spacing: 7) {
                endpointButton(link.sourceId)
                Image(systemName: "arrow.right")
                    .foregroundStyle(MdflowTheme.healthColor(link.healthState))
                endpointButton(link.targetId)
            }
            Text((link.label.isEmpty ? link.kind : link.label).uppercased() + " · " + link.healthState.uppercased())
                .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                .foregroundStyle(MdflowTheme.muted)
        }
    }

    private func endpointButton(_ blockID: String) -> some View {
        Button {
            store.select(GraphSelection(type: .block, id: blockID))
        } label: {
            Text(store.block(blockID).map { store.blockText($0, field: "title") } ?? blockID)
                .lineLimit(2)
                .padding(.horizontal, 8)
                .frame(minHeight: 30)
                .background(MdflowTheme.canvas, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private var revisionSection: some View {
        let revision: Int = switch selection.type {
        case .block: store.snapshot.blocks.first { $0.id == selection.id }?.revision ?? 0
        case .chain: store.snapshot.chains.first { $0.id == selection.id }?.revision ?? 0
        case .link: store.snapshot.links.first { $0.id == selection.id }?.revision ?? 0
        case .plan: store.snapshot.plans.first { $0.id == selection.id }?.revision ?? 0
        }
        return HStack {
            sectionLabel(store.text("revision").uppercased())
            Spacer()
            Text("r\(revision)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(MdflowTheme.muted)
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
                            ForEach(structuredItems(checkpoint.evidence)) { item in
                                HStack(alignment: .top, spacing: 7) {
                                    Circle().fill(MdflowTheme.focus.opacity(0.65)).frame(width: 4, height: 4).padding(.top, 6)
                                    VStack(alignment: .leading, spacing: 2) {
                                        if let eyebrow = item.eyebrow {
                                            Text(localizedType(eyebrow))
                                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                                                .tracking(0.8)
                                        }
                                        Text(item.text).textSelection(.enabled)
                                    }
                                }
                            }
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

    @ViewBuilder
    private func structuredList(_ title: String, value: String) -> some View {
        let items = structuredItems(value)
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                sectionLabel(title)
                ForEach(items) { item in
                    HStack(alignment: .top, spacing: 9) {
                        if let eyebrow = item.eyebrow {
                            Text(localizedType(eyebrow))
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                                .tracking(0.7)
                                .foregroundStyle(MdflowTheme.focus)
                                .padding(.horizontal, 6)
                                .frame(height: 20)
                                .background(MdflowTheme.focus.opacity(0.08), in: Capsule())
                        } else {
                            Circle().fill(MdflowTheme.focus.opacity(0.65)).frame(width: 5, height: 5).padding(.top, 7)
                        }
                        Text(item.text)
                            .font(.system(size: 11.5, design: .rounded))
                            .foregroundStyle(MdflowTheme.ink.opacity(0.86))
                            .lineSpacing(3)
                            .textSelection(.enabled)
                    }
                }
            }
        }
    }

    private struct StructuredItem: Identifiable {
        let id: Int
        let eyebrow: String?
        let text: String
    }

    private func structuredItems(_ value: String) -> [StructuredItem] {
        guard value != "[]", let data = value.data(using: .utf8),
              let values = try? JSONSerialization.jsonObject(with: data) as? [Any]
        else { return value.isEmpty || value == "[]" ? [] : [StructuredItem(id: 0, eyebrow: nil, text: value)] }
        return values.enumerated().compactMap { index, item in
            if let text = item as? String { return StructuredItem(id: index, eyebrow: nil, text: text) }
            guard let dictionary = item as? [String: Any] else { return nil }
            let eyebrow = dictionary["type"] as? String ?? dictionary["kind"] as? String
            let preferred = dictionary["change"] as? String ?? dictionary["result"] as? String ?? dictionary["message"] as? String
            let remaining = dictionary.keys.sorted().filter { !["type", "kind", "change", "result", "message"].contains($0) }.map {
                "\($0): \(String(describing: dictionary[$0]!))"
            }
            let text = ([preferred].compactMap { $0 } + remaining).joined(separator: " · ")
            return text.isEmpty ? nil : StructuredItem(id: index, eyebrow: eyebrow, text: text)
        }
    }

    private func localizedType(_ value: String) -> String {
        guard store.activeLocale == "zh-Hans" else { return value.uppercased() }
        return ["schema": "模型", "canvas": "画布", "interaction": "交互", "evaluation": "验证", "automated-test": "自动测试"][value] ?? value.uppercased()
    }
}
