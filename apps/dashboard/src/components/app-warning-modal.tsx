'use client';

import { cn } from "@stackframe/stack-ui";
import { AlertTriangle, Beaker, X } from "lucide-react";
import { useEffect, useState } from "react";

type AppWarningModalProps = {
  isOpen: boolean,
  onClose: () => void,
  onConfirm: () => void,
  appName: string,
  stage: "alpha" | "beta",
};

export function AppWarningModal({
  isOpen,
  onClose,
  onConfirm,
  appName,
  stage
}: AppWarningModalProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => setIsAnimating(true), 10);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isAlpha = stage === "alpha";

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 transition-opacity duration-200",
          isAnimating ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className={cn(
            "pointer-events-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl",
            "w-full max-w-md transition-all duration-200 transform",
            isAnimating ? "opacity-100 scale-100" : "opacity-0 scale-95"
          )}
        >
          {/* Header */}
          <div className="p-6 pb-0">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center",
                  isAlpha
                    ? "bg-orange-100 dark:bg-orange-950/50"
                    : "bg-blue-100 dark:bg-blue-950/50"
                )}>
                  {isAlpha ? (
                    <AlertTriangle className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                  ) : (
                    <Beaker className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {isAlpha ? "Enable Alpha App" : "Enable Beta App"}
                  </h2>
                  <div className={cn(
                    "mt-1 inline-flex px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wide",
                    "border",
                    isAlpha
                      ? "bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800"
                      : "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                  )}>
                    {stage} Stage
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-6">
            <div className={cn(
              "p-4 rounded-xl mb-4",
              isAlpha
                ? "bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900"
                : "bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900"
            )}>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                You&apos;re about to enable <span className="font-semibold">{appName}</span>.
              </p>
              <p className={cn(
                "text-sm mt-2",
                isAlpha
                  ? "text-orange-700 dark:text-orange-300"
                  : "text-blue-700 dark:text-blue-300"
              )}>
                {isAlpha ? (
                  <>
                    <strong>⚠️ Alpha Warning:</strong> This app is in early development.
                    It may be unstable, have bugs, or break unexpectedly.
                    Use with caution in production environments.
                  </>
                ) : (
                  <>
                    <strong>ℹ️ Beta Notice:</strong> This app is being actively tested.
                    While generally stable, you may encounter some issues.
                    We appreciate your feedback.
                  </>
                )}
              </p>
            </div>

            {/* What to expect */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                What to expect:
              </p>
              <ul className="space-y-1.5">
                {isAlpha ? (
                  <>
                    <li className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="text-orange-500 mt-0.5">•</span>
                      <span>Frequent changes and updates</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="text-orange-500 mt-0.5">•</span>
                      <span>Possible data loss or corruption</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="text-orange-500 mt-0.5">•</span>
                      <span>Limited support and documentation</span>
                    </li>
                  </>
                ) : (
                  <>
                    <li className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>Most features work as expected</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>Occasional bugs or issues</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>Regular updates and improvements</span>
                    </li>
                  </>
                )}
              </ul>
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 pt-0 flex gap-3">
            <button
              onClick={onClose}
              className={cn(
                "flex-1 px-4 py-2.5 rounded-xl font-medium transition-all",
                "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
                "hover:bg-gray-200 dark:hover:bg-gray-700"
              )}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className={cn(
                "flex-1 px-4 py-2.5 rounded-xl font-medium transition-all text-white",
                isAlpha
                  ? "bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600"
                  : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              )}
            >
              Enable Anyway
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
