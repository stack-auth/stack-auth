import Foundation

/// A permission granted to a user within a team or project
public struct TeamPermission: Sendable {
    public let id: String
}

/// A project-level permission
public struct ProjectPermission: Sendable {
    public let id: String
}
