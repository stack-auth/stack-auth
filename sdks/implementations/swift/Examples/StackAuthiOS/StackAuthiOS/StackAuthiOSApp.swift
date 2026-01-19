import SwiftUI
import StackAuth

@main
struct StackAuthiOSApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

// MARK: - Main Content View

struct ContentView: View {
    @State private var viewModel = SDKTestViewModel()
    
    var body: some View {
        TabView {
            NavigationStack {
                AuthenticationView(viewModel: viewModel)
            }
            .tabItem {
                Label("Auth", systemImage: "person.badge.key")
            }
            
            NavigationStack {
                UserView(viewModel: viewModel)
            }
            .tabItem {
                Label("User", systemImage: "person.crop.circle")
            }
            
            NavigationStack {
                TeamsView(viewModel: viewModel)
            }
            .tabItem {
                Label("Teams", systemImage: "person.3")
            }
            
            NavigationStack {
                ServerView(viewModel: viewModel)
            }
            .tabItem {
                Label("Server", systemImage: "server.rack")
            }
            
            NavigationStack {
                SettingsView(viewModel: viewModel)
            }
            .tabItem {
                Label("Settings", systemImage: "gear")
            }
        }
    }
}

// MARK: - View Model

@Observable
class SDKTestViewModel {
    // Configuration
    var baseUrl = "http://localhost:8102"
    var projectId = "internal"
    var publishableClientKey = "this-publishable-client-key-is-for-local-development-only"
    var secretServerKey = "this-secret-server-key-is-for-local-development-only"
    
    // State
    var logs: [LogEntry] = []
    
    // Apps (lazy initialized)
    private var _clientApp: StackClientApp?
    private var _serverApp: StackServerApp?
    
    var clientApp: StackClientApp {
        if _clientApp == nil {
            _clientApp = StackClientApp(
                projectId: projectId,
                publishableClientKey: publishableClientKey,
                baseUrl: baseUrl,
                tokenStore: .memory,
                noAutomaticPrefetch: true
            )
        }
        return _clientApp!
    }
    
    var serverApp: StackServerApp {
        if _serverApp == nil {
            _serverApp = StackServerApp(
                projectId: projectId,
                publishableClientKey: publishableClientKey,
                secretServerKey: secretServerKey,
                baseUrl: baseUrl
            )
        }
        return _serverApp!
    }
    
    func resetApps() {
        _clientApp = nil
        _serverApp = nil
        log("Apps reset with new configuration", type: .info)
    }
    
    func log(_ message: String, type: LogType = .info) {
        let entry = LogEntry(message: message, type: type, timestamp: Date())
        logs.insert(entry, at: 0)
        if logs.count > 50 {
            logs.removeLast()
        }
    }
    
    func clearLogs() {
        logs.removeAll()
    }
}

struct LogEntry: Identifiable {
    let id = UUID()
    let message: String
    let type: LogType
    let timestamp: Date
}

enum LogType {
    case info, success, error
    
    var color: Color {
        switch self {
        case .info: return .secondary
        case .success: return .green
        case .error: return .red
        }
    }
}

// MARK: - Settings View

struct SettingsView: View {
    @Bindable var viewModel: SDKTestViewModel
    
    var body: some View {
        List {
            Section("API Configuration") {
                TextField("Base URL", text: $viewModel.baseUrl)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Project ID", text: $viewModel.projectId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Publishable Client Key", text: $viewModel.publishableClientKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Secret Server Key", text: $viewModel.secretServerKey)
                
                Button("Apply Configuration") {
                    viewModel.resetApps()
                }
            }
            
            Section("Logs (\(viewModel.logs.count))") {
                Button("Clear Logs") {
                    viewModel.clearLogs()
                }
                
                ForEach(viewModel.logs) { entry in
                    VStack(alignment: .leading) {
                        Text(entry.timestamp, style: .time)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(entry.message)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(entry.type.color)
                    }
                }
            }
        }
        .navigationTitle("Settings")
    }
}

// MARK: - Authentication View

struct AuthenticationView: View {
    @Bindable var viewModel: SDKTestViewModel
    @State private var email = ""
    @State private var password = "TestPassword123!"
    @State private var currentUserEmail: String?
    @State private var currentUserId: String?
    
    var body: some View {
        List {
            Section("Credentials") {
                TextField("Email", text: $email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                SecureField("Password", text: $password)
                
                Button("Generate Random Email") {
                    email = "test-\(UUID().uuidString.lowercased().prefix(8))@example.com"
                }
            }
            
            Section("Actions") {
                Button("Sign Up") {
                    Task { await signUp() }
                }
                .disabled(email.isEmpty || password.isEmpty)
                
                Button("Sign In") {
                    Task { await signIn() }
                }
                .disabled(email.isEmpty || password.isEmpty)
                
                Button("Sign In (Wrong Password)") {
                    Task { await signInWrongPassword() }
                }
                .disabled(email.isEmpty)
                
                Button("Sign Out") {
                    Task { await signOut() }
                }
            }
            
            Section("Current User") {
                Button("Refresh User") {
                    Task { await getUser() }
                }
                
                if let email = currentUserEmail, let id = currentUserId {
                    Text("Email: \(email)")
                    Text("ID: \(id)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Not signed in")
                        .foregroundStyle(.secondary)
                }
            }
            
            Section("OAuth") {
                Button("Get Google OAuth URL") {
                    Task { await getOAuthUrl("google") }
                }
                Button("Get GitHub OAuth URL") {
                    Task { await getOAuthUrl("github") }
                }
                Button("Get Microsoft OAuth URL") {
                    Task { await getOAuthUrl("microsoft") }
                }
            }
            
            Section("Error Testing") {
                Button("Get User (or throw)") {
                    Task { await getUserOrThrow() }
                }
            }
        }
        .navigationTitle("Authentication")
        .onAppear {
            Task { await getUser() }
        }
    }
    
    func signUp() async {
        do {
            viewModel.log("Signing up: \(email)")
            try await viewModel.clientApp.signUpWithCredential(email: email, password: password)
            viewModel.log("Sign up successful!", type: .success)
            await getUser()
        } catch {
            viewModel.log("Sign up failed: \(error)", type: .error)
        }
    }
    
    func signIn() async {
        do {
            viewModel.log("Signing in: \(email)")
            try await viewModel.clientApp.signInWithCredential(email: email, password: password)
            viewModel.log("Sign in successful!", type: .success)
            await getUser()
        } catch {
            viewModel.log("Sign in failed: \(error)", type: .error)
        }
    }
    
    func signInWrongPassword() async {
        do {
            viewModel.log("Signing in with wrong password...")
            try await viewModel.clientApp.signInWithCredential(email: email, password: "WrongPassword!")
            viewModel.log("Sign in succeeded (unexpected)", type: .error)
        } catch let error as EmailPasswordMismatchError {
            viewModel.log("Got EmailPasswordMismatchError: \(error.message)", type: .success)
        } catch {
            viewModel.log("Unexpected error: \(error)", type: .error)
        }
    }
    
    func signOut() async {
        do {
            viewModel.log("Signing out...")
            try await viewModel.clientApp.signOut()
            viewModel.log("Sign out successful!", type: .success)
            currentUserEmail = nil
            currentUserId = nil
        } catch {
            viewModel.log("Sign out failed: \(error)", type: .error)
        }
    }
    
    func getUser() async {
        do {
            let user = try await viewModel.clientApp.getUser()
            if let user = user {
                currentUserEmail = await user.primaryEmail
                currentUserId = await user.id
                viewModel.log("Got user: \(currentUserEmail ?? "nil")", type: .success)
            } else {
                currentUserEmail = nil
                currentUserId = nil
                viewModel.log("No user signed in", type: .info)
            }
        } catch {
            viewModel.log("Get user failed: \(error)", type: .error)
        }
    }
    
    func getUserOrThrow() async {
        do {
            viewModel.log("Getting user (or throw)...")
            let user = try await viewModel.clientApp.getUser(or: .throw)
            if let user = user {
                let email = await user.primaryEmail
                viewModel.log("Got user: \(email ?? "nil")", type: .success)
            } else {
                viewModel.log("No user (unexpected with .throw)", type: .error)
            }
        } catch let error as UserNotSignedInError {
            viewModel.log("Got UserNotSignedInError: \(error.message)", type: .success)
        } catch {
            viewModel.log("Unexpected error: \(error)", type: .error)
        }
    }
    
    func getOAuthUrl(_ provider: String) async {
        do {
            viewModel.log("Getting OAuth URL for \(provider)...")
            let result = try await viewModel.clientApp.getOAuthUrl(provider: provider)
            viewModel.log("URL: \(result.url)", type: .success)
            viewModel.log("State: \(result.state.prefix(20))...", type: .info)
        } catch {
            viewModel.log("Get OAuth URL failed: \(error)", type: .error)
        }
    }
}

// MARK: - User View

struct UserView: View {
    @Bindable var viewModel: SDKTestViewModel
    @State private var displayName = ""
    @State private var metadataKey = "theme"
    @State private var metadataValue = "dark"
    @State private var oldPassword = "TestPassword123!"
    @State private var newPassword = "NewPassword456!"
    @State private var channels: [(id: String, value: String, isPrimary: Bool)] = []
    
    var body: some View {
        List {
            Section("Display Name") {
                TextField("Display Name", text: $displayName)
                
                Button("Set Display Name") {
                    Task { await setDisplayName() }
                }
                .disabled(displayName.isEmpty)
            }
            
            Section("Client Metadata") {
                TextField("Key", text: $metadataKey)
                TextField("Value", text: $metadataValue)
                
                Button("Update Metadata") {
                    Task { await updateMetadata() }
                }
            }
            
            Section("Password") {
                SecureField("Old Password", text: $oldPassword)
                SecureField("New Password", text: $newPassword)
                
                Button("Update Password") {
                    Task { await updatePassword() }
                }
                
                Button("Update (Wrong Old Password)") {
                    Task { await updatePasswordWrong() }
                }
            }
            
            Section("Tokens") {
                Button("Get Access Token") {
                    Task { await getAccessToken() }
                }
                Button("Get Refresh Token") {
                    Task { await getRefreshToken() }
                }
                Button("Get Auth Headers") {
                    Task { await getAuthHeaders() }
                }
                Button("Get Partial User") {
                    Task { await getPartialUser() }
                }
            }
            
            Section("Contact Channels") {
                Button("List Contact Channels") {
                    Task { await listChannels() }
                }
                
                ForEach(channels, id: \.id) { channel in
                    HStack {
                        Text(channel.value)
                        Spacer()
                        if channel.isPrimary {
                            Text("Primary")
                                .font(.caption)
                                .foregroundStyle(.blue)
                        }
                    }
                }
            }
        }
        .navigationTitle("User")
    }
    
    func setDisplayName() async {
        do {
            guard let user = try await viewModel.clientApp.getUser() else {
                viewModel.log("No user signed in", type: .error)
                return
            }
            viewModel.log("Setting display name: \(displayName)")
            try await user.setDisplayName(displayName)
            viewModel.log("Display name set!", type: .success)
        } catch {
            viewModel.log("Set display name failed: \(error)", type: .error)
        }
    }
    
    func updateMetadata() async {
        do {
            guard let user = try await viewModel.clientApp.getUser() else {
                viewModel.log("No user signed in", type: .error)
                return
            }
            viewModel.log("Updating metadata: \(metadataKey)=\(metadataValue)")
            try await user.update(clientMetadata: [metadataKey: metadataValue])
            viewModel.log("Metadata updated!", type: .success)
        } catch {
            viewModel.log("Update metadata failed: \(error)", type: .error)
        }
    }
    
    func updatePassword() async {
        do {
            guard let user = try await viewModel.clientApp.getUser() else {
                viewModel.log("No user signed in", type: .error)
                return
            }
            viewModel.log("Updating password...")
            try await user.updatePassword(oldPassword: oldPassword, newPassword: newPassword)
            viewModel.log("Password updated!", type: .success)
        } catch {
            viewModel.log("Update password failed: \(error)", type: .error)
        }
    }
    
    func updatePasswordWrong() async {
        do {
            guard let user = try await viewModel.clientApp.getUser() else {
                viewModel.log("No user signed in", type: .error)
                return
            }
            viewModel.log("Updating password with wrong old...")
            try await user.updatePassword(oldPassword: "WrongPassword!", newPassword: newPassword)
            viewModel.log("Password updated (unexpected)", type: .error)
        } catch let error as PasswordConfirmationMismatchError {
            viewModel.log("Got PasswordConfirmationMismatchError", type: .success)
        } catch {
            viewModel.log("Unexpected error: \(error)", type: .error)
        }
    }
    
    func getAccessToken() async {
        let token = await viewModel.clientApp.getAccessToken()
        if let token = token {
            viewModel.log("Access token: \(token.prefix(40))...", type: .success)
        } else {
            viewModel.log("No access token", type: .info)
        }
    }
    
    func getRefreshToken() async {
        let token = await viewModel.clientApp.getRefreshToken()
        if let token = token {
            viewModel.log("Refresh token: \(token.prefix(20))...", type: .success)
        } else {
            viewModel.log("No refresh token", type: .info)
        }
    }
    
    func getAuthHeaders() async {
        let headers = await viewModel.clientApp.getAuthHeaders()
        viewModel.log("Auth headers: \(headers.keys.joined(separator: ", "))", type: .success)
    }
    
    func getPartialUser() async {
        let user = await viewModel.clientApp.getPartialUser()
        if let user = user {
            viewModel.log("Partial user: \(user.primaryEmail ?? "nil")", type: .success)
        } else {
            viewModel.log("No partial user", type: .info)
        }
    }
    
    func listChannels() async {
        do {
            guard let user = try await viewModel.clientApp.getUser() else {
                viewModel.log("No user signed in", type: .error)
                return
            }
            viewModel.log("Listing contact channels...")
            let channelsList = try await user.listContactChannels()
            var results: [(id: String, value: String, isPrimary: Bool)] = []
            for channel in channelsList {
                let value = await channel.value
                let isPrimary = await channel.isPrimary
                results.append((id: channel.id, value: value, isPrimary: isPrimary))
            }
            channels = results
            viewModel.log("Found \(channels.count) channels", type: .success)
        } catch {
            viewModel.log("List channels failed: \(error)", type: .error)
        }
    }
}

// MARK: - Teams View

struct TeamsView: View {
    @Bindable var viewModel: SDKTestViewModel
    @State private var teamName = ""
    @State private var teams: [(id: String, name: String)] = []
    @State private var selectedTeamId = ""
    @State private var teamMembers: [String] = []
    
    var body: some View {
        List {
            Section("Create Team") {
                TextField("Team Name", text: $teamName)
                
                Button("Generate Random Name") {
                    teamName = "Team \(UUID().uuidString.prefix(8))"
                }
                
                Button("Create Team") {
                    Task { await createTeam() }
                }
                .disabled(teamName.isEmpty)
            }
            
            Section("My Teams") {
                Button("Refresh Teams") {
                    Task { await listTeams() }
                }
                
                ForEach(teams, id: \.id) { team in
                    Button {
                        selectedTeamId = team.id
                        Task { await listTeamMembers() }
                    } label: {
                        HStack {
                            Text(team.name)
                            Spacer()
                            if team.id == selectedTeamId {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
            
            if !selectedTeamId.isEmpty {
                Section("Team Members (\(selectedTeamId.prefix(8))...)") {
                    Button("Refresh Members") {
                        Task { await listTeamMembers() }
                    }
                    
                    ForEach(teamMembers, id: \.self) { userId in
                        Text(userId)
                            .font(.caption)
                    }
                }
                
                Section("Team Actions") {
                    Button("Update Team Name") {
                        Task { await updateTeamName() }
                    }
                    .disabled(teamName.isEmpty)
                }
            }
        }
        .navigationTitle("Teams")
        .onAppear {
            Task { await listTeams() }
        }
    }
    
    func createTeam() async {
        do {
            guard let user = try await viewModel.clientApp.getUser() else {
                viewModel.log("No user signed in", type: .error)
                return
            }
            viewModel.log("Creating team: \(teamName)")
            let team = try await user.createTeam(displayName: teamName)
            viewModel.log("Team created: \(team.id)", type: .success)
            await listTeams()
        } catch {
            viewModel.log("Create team failed: \(error)", type: .error)
        }
    }
    
    func listTeams() async {
        do {
            guard let user = try await viewModel.clientApp.getUser() else {
                viewModel.log("No user signed in", type: .error)
                return
            }
            viewModel.log("Listing teams...")
            let teamsList = try await user.listTeams()
            var results: [(id: String, name: String)] = []
            for team in teamsList {
                let name = await team.displayName
                results.append((id: team.id, name: name))
            }
            teams = results
            viewModel.log("Found \(teams.count) teams", type: .success)
        } catch {
            viewModel.log("List teams failed: \(error)", type: .error)
        }
    }
    
    func listTeamMembers() async {
        do {
            guard let user = try await viewModel.clientApp.getUser() else {
                viewModel.log("No user signed in", type: .error)
                return
            }
            guard let team = try await user.getTeam(id: selectedTeamId) else {
                viewModel.log("Team not found", type: .error)
                return
            }
            viewModel.log("Listing team members...")
            let members = try await team.listUsers()
            teamMembers = members.map { $0.id }
            viewModel.log("Found \(members.count) members", type: .success)
        } catch {
            viewModel.log("List members failed: \(error)", type: .error)
        }
    }
    
    func updateTeamName() async {
        do {
            guard let user = try await viewModel.clientApp.getUser() else {
                viewModel.log("No user signed in", type: .error)
                return
            }
            guard let team = try await user.getTeam(id: selectedTeamId) else {
                viewModel.log("Team not found", type: .error)
                return
            }
            viewModel.log("Updating team name: \(teamName)")
            try await team.update(displayName: teamName)
            viewModel.log("Team updated!", type: .success)
            await listTeams()
        } catch {
            viewModel.log("Update team failed: \(error)", type: .error)
        }
    }
}

// MARK: - Server View

struct ServerView: View {
    @Bindable var viewModel: SDKTestViewModel
    @State private var email = ""
    @State private var displayName = ""
    @State private var userId = ""
    @State private var teamName = ""
    @State private var teamId = ""
    @State private var users: [(id: String, email: String?)] = []
    @State private var teams: [(id: String, name: String)] = []
    
    var body: some View {
        List {
            Section("Create User") {
                TextField("Email", text: $email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                TextField("Display Name", text: $displayName)
                
                Button("Generate Random Email") {
                    email = "test-\(UUID().uuidString.lowercased().prefix(8))@example.com"
                }
                
                Button("Create User") {
                    Task { await createUser() }
                }
                .disabled(email.isEmpty)
                
                Button("Create User (All Options)") {
                    Task { await createUserWithOptions() }
                }
                .disabled(email.isEmpty)
            }
            
            Section("Users") {
                Button("List Users") {
                    Task { await listUsers() }
                }
                
                ForEach(users, id: \.id) { user in
                    Button {
                        userId = user.id
                    } label: {
                        HStack {
                            Text(user.email ?? "no email")
                            Spacer()
                            if user.id == userId {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
            
            Section("User Operations") {
                TextField("User ID", text: $userId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                
                Button("Get User") {
                    Task { await getUser() }
                }
                .disabled(userId.isEmpty)
                
                Button("Delete User") {
                    Task { await deleteUser() }
                }
                .disabled(userId.isEmpty)
                
                Button("Create Session (Impersonate)") {
                    Task { await createSession() }
                }
                .disabled(userId.isEmpty)
            }
            
            Section("Create Team") {
                TextField("Team Name", text: $teamName)
                
                Button("Generate Random Name") {
                    teamName = "Team \(UUID().uuidString.prefix(8))"
                }
                
                Button("Create Team") {
                    Task { await createTeam() }
                }
                .disabled(teamName.isEmpty)
            }
            
            Section("Teams") {
                Button("List Teams") {
                    Task { await listTeams() }
                }
                
                ForEach(teams, id: \.id) { team in
                    Button {
                        teamId = team.id
                    } label: {
                        HStack {
                            Text(team.name)
                            Spacer()
                            if team.id == teamId {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
            
            Section("Team Operations") {
                TextField("Team ID", text: $teamId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                
                Button("Add User to Team") {
                    Task { await addUserToTeam() }
                }
                .disabled(teamId.isEmpty || userId.isEmpty)
                
                Button("Remove User from Team") {
                    Task { await removeUserFromTeam() }
                }
                .disabled(teamId.isEmpty || userId.isEmpty)
                
                Button("List Team Users") {
                    Task { await listTeamUsers() }
                }
                .disabled(teamId.isEmpty)
                
                Button("Delete Team") {
                    Task { await deleteTeam() }
                }
                .disabled(teamId.isEmpty)
            }
        }
        .navigationTitle("Server")
    }
    
    func createUser() async {
        do {
            viewModel.log("Creating user: \(email)")
            let user = try await viewModel.serverApp.createUser(email: email)
            viewModel.log("User created: \(user.id)", type: .success)
            userId = user.id
            await listUsers()
        } catch {
            viewModel.log("Create user failed: \(error)", type: .error)
        }
    }
    
    func createUserWithOptions() async {
        do {
            viewModel.log("Creating user with options: \(email)")
            let user = try await viewModel.serverApp.createUser(
                email: email,
                password: "TestPassword123!",
                displayName: displayName.isEmpty ? nil : displayName,
                primaryEmailVerified: true,
                clientMetadata: ["source": "iOS-example"],
                serverMetadata: ["created_via": "example-app"]
            )
            viewModel.log("User created: \(user.id)", type: .success)
            userId = user.id
            await listUsers()
        } catch {
            viewModel.log("Create user failed: \(error)", type: .error)
        }
    }
    
    func listUsers() async {
        do {
            viewModel.log("Listing users...")
            let result = try await viewModel.serverApp.listUsers(limit: 5)
            var usersList: [(id: String, email: String?)] = []
            for user in result.items {
                let email = await user.primaryEmail
                usersList.append((id: user.id, email: email))
            }
            users = usersList
            viewModel.log("Found \(users.count) users", type: .success)
        } catch {
            viewModel.log("List users failed: \(error)", type: .error)
        }
    }
    
    func getUser() async {
        do {
            viewModel.log("Getting user: \(userId)")
            let user = try await viewModel.serverApp.getUser(id: userId)
            if let user = user {
                let email = await user.primaryEmail
                viewModel.log("User: \(email ?? "nil")", type: .success)
            } else {
                viewModel.log("User not found", type: .info)
            }
        } catch {
            viewModel.log("Get user failed: \(error)", type: .error)
        }
    }
    
    func deleteUser() async {
        do {
            viewModel.log("Deleting user: \(userId)")
            guard let user = try await viewModel.serverApp.getUser(id: userId) else {
                viewModel.log("User not found", type: .error)
                return
            }
            try await user.delete()
            viewModel.log("User deleted!", type: .success)
            userId = ""
            await listUsers()
        } catch {
            viewModel.log("Delete user failed: \(error)", type: .error)
        }
    }
    
    func createSession() async {
        do {
            viewModel.log("Creating session for: \(userId)")
            let tokens = try await viewModel.serverApp.createSession(userId: userId)
            viewModel.log("Session created!", type: .success)
            viewModel.log("Access token: \(tokens.accessToken.prefix(30))...", type: .info)
        } catch {
            viewModel.log("Create session failed: \(error)", type: .error)
        }
    }
    
    func createTeam() async {
        do {
            viewModel.log("Creating team: \(teamName)")
            let team = try await viewModel.serverApp.createTeam(displayName: teamName)
            viewModel.log("Team created: \(team.id)", type: .success)
            teamId = team.id
            await listTeams()
        } catch {
            viewModel.log("Create team failed: \(error)", type: .error)
        }
    }
    
    func listTeams() async {
        do {
            viewModel.log("Listing teams...")
            let teamsList = try await viewModel.serverApp.listTeams()
            var results: [(id: String, name: String)] = []
            for team in teamsList {
                let name = await team.displayName
                results.append((id: team.id, name: name))
            }
            teams = results
            viewModel.log("Found \(teams.count) teams", type: .success)
        } catch {
            viewModel.log("List teams failed: \(error)", type: .error)
        }
    }
    
    func addUserToTeam() async {
        do {
            viewModel.log("Adding user to team...")
            guard let team = try await viewModel.serverApp.getTeam(id: teamId) else {
                viewModel.log("Team not found", type: .error)
                return
            }
            try await team.addUser(id: userId)
            viewModel.log("User added to team!", type: .success)
        } catch {
            viewModel.log("Add user failed: \(error)", type: .error)
        }
    }
    
    func removeUserFromTeam() async {
        do {
            viewModel.log("Removing user from team...")
            guard let team = try await viewModel.serverApp.getTeam(id: teamId) else {
                viewModel.log("Team not found", type: .error)
                return
            }
            try await team.removeUser(id: userId)
            viewModel.log("User removed from team!", type: .success)
        } catch {
            viewModel.log("Remove user failed: \(error)", type: .error)
        }
    }
    
    func listTeamUsers() async {
        do {
            viewModel.log("Listing team users...")
            guard let team = try await viewModel.serverApp.getTeam(id: teamId) else {
                viewModel.log("Team not found", type: .error)
                return
            }
            let users = try await team.listUsers()
            viewModel.log("Found \(users.count) users", type: .success)
            for user in users {
                viewModel.log("  - \(user.id)", type: .info)
            }
        } catch {
            viewModel.log("List team users failed: \(error)", type: .error)
        }
    }
    
    func deleteTeam() async {
        do {
            viewModel.log("Deleting team: \(teamId)")
            guard let team = try await viewModel.serverApp.getTeam(id: teamId) else {
                viewModel.log("Team not found", type: .error)
                return
            }
            try await team.delete()
            viewModel.log("Team deleted!", type: .success)
            teamId = ""
            await listTeams()
        } catch {
            viewModel.log("Delete team failed: \(error)", type: .error)
        }
    }
}

#Preview {
    ContentView()
}
