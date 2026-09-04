import SwiftUI

struct ContentView: View {
    @StateObject private var store = GraphStore()
    private let timer = Timer.publish(every: 0.35, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Divider()
            VStack(spacing: 0) {
                canvasToolbar
                Divider()
                GraphCanvasView(store: store)
                    .overlay(alignment: .topLeading) { errorBanner }
                    .overlay(alignment: .bottomTrailing) { zoomControl }
            }
            if let selection = store.selection {
                Divider()
                DetailView(store: store, selection: selection)
                    .frame(width: 320)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .frame(minWidth: 980, minHeight: 650)
        .background(MdflowTheme.canvas)
        .onReceive(timer) { _ in store.refreshIfChanged() }
        .sheet(isPresented: $store.settingsPresented) {
            SettingsView(store: store)
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Button { store.showOverview() } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(store.snapshot.project.name)
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .foregroundStyle(MdflowTheme.ink)
                            .lineLimit(1)
                        Text(store.text("overview").uppercased())
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .tracking(1.4)
                            .foregroundStyle(MdflowTheme.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)

                Menu {
                    if !store.recentProjects.isEmpty {
                        Section(store.text("recentProjects")) {
                            ForEach(store.recentProjects) { project in
                                Button { store.openProject(project) } label: {
                                    if project.path == store.projectRoot {
                                        Label(project.name, systemImage: "checkmark")
                                    } else {
                                        Text(project.name)
                                    }
                                }
                            }
                        }
                        Divider()
                    }
                    Button(store.text("openProject")) { store.chooseProject() }
                } label: {
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(MdflowTheme.muted)
                        .frame(width: 26, height: 30)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
            }
            .padding(18)

            Divider().padding(.horizontal, 14)

            Text(store.text("plans").uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.4)
                .foregroundStyle(MdflowTheme.muted)
                .padding(.horizontal, 18)
                .padding(.top, 20)
                .padding(.bottom, 10)

            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(store.plans) { plan in
                        Button { store.focusPlan(plan.id) } label: {
                            HStack(spacing: 9) {
                                Circle()
                                    .fill(MdflowTheme.planColor(plan.status))
                                    .frame(width: 7, height: 7)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(store.planText(plan, field: "title"))
                                    Text(plan.status.uppercased())
                                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                                        .tracking(1)
                                        .foregroundStyle(MdflowTheme.planColor(plan.status))
                                }
                                    .font(.system(size: 12, weight: .medium, design: .rounded))
                                    .foregroundStyle(MdflowTheme.ink)
                                    .lineLimit(2)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(store.selection == GraphSelection(type: .plan, id: plan.id) ? MdflowTheme.focus.opacity(0.09) : .clear)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 7)
            }
            Spacer()
        }
        .frame(width: 212)
        .background(MdflowTheme.surface.opacity(0.94))
    }

    private var canvasToolbar: some View {
        HStack(spacing: 14) {
            ForEach(ViewLens.allCases) { lens in
                Toggle(
                    store.lensTitle(lens),
                    isOn: Binding(
                        get: { store.enabledLenses.contains(lens) },
                        set: { store.setLens(lens, enabled: $0) }
                    )
                )
                .toggleStyle(.checkbox)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(MdflowTheme.ink)
            }
            Spacer()
            search
            Button { store.settingsPresented = true } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(MdflowTheme.ink)
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
            .help(store.text("settings"))
        }
        .padding(.horizontal, 16)
        .frame(height: 50)
        .background(MdflowTheme.surface.opacity(0.96))
    }

    private var search: some View {
        TextField(store.text("search"), text: $store.searchText)
            .textFieldStyle(.plain)
            .font(.system(size: 11.5, weight: .regular, design: .rounded))
            .padding(.horizontal, 11)
            .frame(width: 180, height: 30)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(MdflowTheme.canvas)
                    .stroke(MdflowTheme.hairline)
            )
            .overlay(alignment: .topTrailing) {
                if !store.searchResults.isEmpty {
                    VStack(spacing: 2) {
                        ForEach(store.searchResults, id: \.self) { result in
                            Button { store.selectSearchResult(result) } label: {
                                Text(store.title(for: result))
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(MdflowTheme.ink)
                                    .lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(9)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(5)
                    .frame(width: 230)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(MdflowTheme.surface)
                            .shadow(color: .black.opacity(0.13), radius: 18, y: 8)
                    )
                    .offset(y: 36)
                    .zIndex(20)
                }
            }
            .zIndex(20)
    }

    private var zoomControl: some View {
        HStack(spacing: 2) {
            Button { store.zoom(by: -0.1) } label: {
                Image(systemName: "minus").frame(width: 42, height: 42)
            }
                .help("Zoom out")
            Button { store.resetZoom() } label: {
                Text("\(Int((store.canvasScale * 100).rounded()))%")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .frame(width: 58, height: 42)
            }
            .help("Reset zoom")
            Button { store.zoom(by: 0.1) } label: {
                Image(systemName: "plus").frame(width: 42, height: 42)
            }
                .help("Zoom in")
        }
        .buttonStyle(.plain)
        .padding(5)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(MdflowTheme.hairline))
        .contentShape(Rectangle())
        .padding(18)
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let error = store.errorMessage {
            VStack(alignment: .leading, spacing: 9) {
                Text(error)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(MdflowTheme.failure)
                Button(store.text("openProject")) { store.chooseProject() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(MdflowTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .padding(16)
        }
    }
}

private struct SettingsView: View {
    @ObservedObject var store: GraphStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                Text(store.text("settings"))
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                Spacer()
                Button(store.text("done")) { dismiss() }
            }
            VStack(alignment: .leading, spacing: 8) {
                label(store.text("language").uppercased())
                Picker(store.text("language"), selection: $store.language) {
                    Text(store.text("system")).tag(AppLanguage.system)
                    Text(store.text("chinese")).tag(AppLanguage.zhHans)
                    Text(store.text("english")).tag(AppLanguage.english)
                }
                .pickerStyle(.segmented)
            }
            VStack(alignment: .leading, spacing: 8) {
                label(store.text("plugin"))
                Text(store.text("pluginHelp"))
                    .font(.system(size: 12, design: .rounded))
                Button(store.text("revealPlugin")) { store.revealPlugin() }
            }
            VStack(alignment: .leading, spacing: 8) {
                label(store.text("liveData"))
                Text(store.databasePath)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(MdflowTheme.muted)
                    .textSelection(.enabled)
                Text(store.text("liveHelp"))
                    .font(.system(size: 12, design: .rounded))
                Button(store.text("changeProject")) { store.chooseProject() }
            }
            Spacer()
        }
        .padding(28)
        .frame(width: 480, height: 410)
    }

    private func label(_ value: String) -> some View {
        Text(value)
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(1.4)
            .foregroundStyle(MdflowTheme.muted)
    }
}
