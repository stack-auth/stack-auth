import { useState, useMemo } from "react";
import { format } from "date-fns";
import { clsx } from "clsx";
import type { McpCallLogRow } from "../types";
import { toDate } from "../utils";

type KbFilter = "all" | "published" | "draft";

export function KnowledgeBase({ rows, onSave, onDelete }: {
  rows: McpCallLogRow[];
  onSave: (correlationId: string, question: string, answer: string, publish: boolean) => void;
  onDelete: (correlationId: string) => void;
}) {
  const [filter, setFilter] = useState<KbFilter>("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const kbRows = useMemo(() => {
    let result = rows.filter(r => (r.humanCorrectedAnswer != null && r.humanCorrectedAnswer !== "") || r.publishedToQa);

    if (filter === "published") {
      result = result.filter(r => r.publishedToQa);
    } else if (filter === "draft") {
      result = result.filter(r => !r.publishedToQa);
    }

    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(r =>
        (r.humanCorrectedQuestion ?? r.question).toLowerCase().includes(lower) ||
        (r.humanCorrectedAnswer ?? r.response).toLowerCase().includes(lower)
      );
    }

    return result.sort((a, b) => {
      const aTime = a.publishedAt ? Number(toDate(a.publishedAt)) : Number(toDate(a.createdAt));
      const bTime = b.publishedAt ? Number(toDate(b.publishedAt)) : Number(toDate(b.createdAt));
      return bTime - aTime;
    });
  }, [rows, filter, search]);

  const publishedCount = rows.filter(r => r.publishedToQa).length;
  const draftCount = rows.filter(r => r.humanCorrectedAnswer != null && r.humanCorrectedAnswer !== "" && !r.publishedToQa).length;

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 space-y-2">
        <input
          type="text"
          placeholder="Search questions and answers..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setFilter("all")}
            className={clsx(
              "px-2 py-1 text-xs rounded",
              filter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            All ({publishedCount + draftCount})
          </button>
          <button
            onClick={() => setFilter("published")}
            className={clsx(
              "px-2 py-1 text-xs rounded",
              filter === "published" ? "bg-green-700 text-white" : "bg-green-50 text-green-700 hover:bg-green-100"
            )}
          >
            Published ({publishedCount})
          </button>
          <button
            onClick={() => setFilter("draft")}
            className={clsx(
              "px-2 py-1 text-xs rounded",
              filter === "draft" ? "bg-amber-700 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"
            )}
          >
            Drafts ({draftCount})
          </button>
        </div>
      </div>

      {/* List */}
      {kbRows.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          <p className="text-sm">No Q&A entries yet</p>
          <p className="text-xs mt-1">Add one with the "+ Add Q&A" button above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {kbRows.map(row => (
            <KbCard
              key={String(row.id)}
              row={row}
              isEditing={editingId === row.correlationId}
              onStartEdit={() => setEditingId(row.correlationId)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(question, answer, publish) => {
                onSave(row.correlationId, question, answer, publish);
                setEditingId(null);
              }}
              onDelete={() => onDelete(row.correlationId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KbCard({ row, isEditing, onStartEdit, onCancelEdit, onSave, onDelete }: {
  row: McpCallLogRow;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (question: string, answer: string, publish: boolean) => void;
  onDelete: () => void;
}) {
  const question = row.humanCorrectedQuestion ?? row.question;
  const answer = row.humanCorrectedAnswer ?? row.response;

  const [editQuestion, setEditQuestion] = useState(question);
  const [editAnswer, setEditAnswer] = useState(answer);

  const cardBorder = row.publishedToQa ? "border-green-200" : "border-amber-200";
  const cardBg = row.publishedToQa ? "bg-green-50/30" : "bg-amber-50/30";

  if (isEditing) {
    return (
      <div className={`border ${cardBorder} ${cardBg} rounded-lg p-4 space-y-3`}>
        <div>
          <label className="text-[10px] uppercase text-gray-400 font-medium mb-1 block tracking-wider">Question</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            value={editQuestion}
            onChange={(e) => setEditQuestion(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-gray-400 font-medium mb-1 block tracking-wider">Answer</label>
          <textarea
            className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y bg-white"
            value={editAnswer}
            onChange={(e) => setEditAnswer(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onCancelEdit}
            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(editQuestion, editAnswer, false)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Save Draft
          </button>
          <button
            onClick={() => onSave(editQuestion, editAnswer, true)}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            {row.publishedToQa ? "Update & Publish" : "Save & Publish"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`border ${cardBorder} ${cardBg} rounded-lg overflow-hidden`}>
      {/* Header */}
      <div className="px-4 py-2 border-b border-inherit flex items-center justify-between">
        <div className="flex items-center gap-2">
          {row.publishedToQa ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">
              &#10003; Published
            </span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-800">
              Draft
            </span>
          )}
          {row.toolName === "manual" && (
            <span className="text-[10px] text-gray-400">manual</span>
          )}
          {row.publishedAt && (
            <span className="text-[10px] text-gray-400">
              {format(toDate(row.publishedAt), "MMM d, yyyy")}
            </span>
          )}
          {row.humanReviewedBy && (
            <span className="text-[10px] text-gray-400">by {row.humanReviewedBy}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onStartEdit}
            className="px-2 py-0.5 text-[10px] text-blue-600 hover:text-blue-800"
          >
            Edit
          </button>
          {row.publishedToQa ? (
            <button
              onClick={() => onSave(question, answer, false)}
              className="px-2 py-0.5 text-[10px] text-amber-600 hover:text-amber-800"
            >
              Unpublish
            </button>
          ) : (
            <button
              onClick={() => onSave(question, answer, true)}
              className="px-2 py-0.5 text-[10px] text-green-600 hover:text-green-800"
            >
              Publish
            </button>
          )}
          <button
            onClick={onDelete}
            className="px-2 py-0.5 text-[10px] text-red-500 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-1">
        <p className="text-sm font-medium text-gray-900">{question}</p>
        <p className="text-xs text-gray-600 line-clamp-3 whitespace-pre-wrap">{answer}</p>
      </div>
    </div>
  );
}
