import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChangelogEntry } from "@/lib/parse-changelogs";
import { parseRootChangelog } from "@/lib/parse-changelogs";
import { getMonorepoRoot } from "@/lib/monorepo-root";

function getChangelogEntries(): ChangelogEntry[] {
  try {
    return parseRootChangelog(getMonorepoRoot());
  } catch (error) {
    console.error("Failed to parse CHANGELOG.md", error);
    return [];
  }
}

function VersionEntry({ entry, defaultOpen = false }: { entry: ChangelogEntry; defaultOpen?: boolean }) {
  const hasContent = entry.markdown.length > 0;
  const detailProps = defaultOpen ? { open: true } : {};
  let bulletIndex = 0;

  return (
    <details className={`version-entry ${entry.type}`} {...detailProps}>
      <summary className="version-summary">
        <div className="version-header">
          <h2 className="version-number">{entry.version}</h2>
          {entry.releasedAt && (
            <time className="version-date" dateTime={entry.releasedAt}>
              {entry.releasedAt}
            </time>
          )}
          <span className={`version-badge ${entry.type}`}>
            {entry.type}
          </span>
        </div>
      </summary>

      <div className="version-body">
        {hasContent ? (
          <ReactMarkdown
            className="version-body-markdown"
            remarkPlugins={[remarkGfm]}
            components={{
              li: ({ node, children, ...props }) => {
                const meta = entry.bullets?.[bulletIndex] ?? null;
                if (meta) {
                  bulletIndex += 1;
                }
                const tags = meta?.tags ?? [];
                return (
                  <li {...props}>
                    <div className="list-line">
                      {tags.length > 0 && (
                        <span className="tag-group">
                          {tags.map((tag) => (
                            <span key={tag} className="tag-pill">
                              {tag}
                            </span>
                          ))}
                        </span>
                      )}
                      <div className="list-text">{children}</div>
                    </div>
                  </li>
                );
              },
              img: ({ node, ...props }) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" {...props} />
              ),
            }}
          >
            {entry.markdown}
          </ReactMarkdown>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.9375rem' }}>
            Internal improvements and dependency updates
          </p>
        )}

      </div>
    </details>
  );
}

export default function ChangelogPage() {
  const entries = getChangelogEntries();
  const unreleased = entries.filter(entry => entry.isUnreleased);
  const releases = entries.filter(entry => !entry.isUnreleased);
  const latestVersion = releases[0]?.version ?? (unreleased[0]?.version ?? "Unreleased");
  const totalVersions = releases.length;
  const totalChanges = entries.reduce((count, entry) => count + entry.bulletCount, 0);
  const displayVersions = releases.slice(0, 50);

  return (
    <main>
      <div className="container">
        <header className="header">
          <h1 className="header-title">Changelog</h1>
          <p className="header-subtitle">
            All changes, updates, and improvements to Stack Auth
          </p>
        </header>

        <div className="stats-bar">
          <div className="stat">
            <span className="stat-value">{latestVersion}</span>
            <span className="stat-label">Latest</span>
          </div>
          <div className="stat">
            <span className="stat-value">{totalVersions}</span>
            <span className="stat-label">Releases</span>
          </div>
          <div className="stat">
            <span className="stat-value">{totalChanges}</span>
            <span className="stat-label">Documented changes</span>
          </div>
        </div>

        {unreleased.length > 0 && (
          <section className="timeline">
            <h2 className="unreleased-heading">Unreleased</h2>
            {unreleased.map(entry => (
              <VersionEntry key={entry.version} entry={entry} />
            ))}
          </section>
        )}

        <section className="timeline">
          {displayVersions.length > 0 ? (
            displayVersions.map((entry, index) => (
              <VersionEntry key={entry.version} entry={entry} defaultOpen={index === 0} />
            ))
          ) : (
            <div className="empty-state">
              <p>No changelog entries found.</p>
              <p>Add entries to <code>CHANGELOG.md</code> at the repo root.</p>
            </div>
          )}
        </section>

        <aside className="historical-note">
          Anything older than <strong>2.8.50</strong> lives in the original package-specific CHANGELOG.md
          files on{" "}
          <a href="https://github.com/stack-auth/stack" target="_blank" rel="noreferrer">
            GitHub
          </a>{" "}
          for historical reference only.
        </aside>

        <footer className="footer">
          <p>
            <a href="https://stack-auth.com" target="_blank" rel="noopener noreferrer">
              Stack Auth
            </a>
            {' · '}
            <a href="https://docs.stack-auth.com" target="_blank" rel="noopener noreferrer">
              Documentation
            </a>
            {' · '}
            <a href="https://github.com/stack-auth/stack" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
