"use client";
import {workspaceStorageKey} from "./workspace-scope";

const SORT_KEY     = "listing-writer:sort-model";
const ANALYSIS_KEY = "listing-writer:analysis-model";

export function getSortModel(): string | null {
  try {
    return window.localStorage.getItem(workspaceStorageKey(SORT_KEY));
  } catch {
    return null;
  }
}

export function saveSortModel(model: string): void {
  try {
    window.localStorage.setItem(workspaceStorageKey(SORT_KEY), model);
  } catch {
    /* private browsing — pref won't persist */
  }
}

export function getAnalysisModel(): string | null {
  try {
    return window.localStorage.getItem(workspaceStorageKey(ANALYSIS_KEY));
  } catch {
    return null;
  }
}

export function saveAnalysisModel(model: string): void {
  try {
    window.localStorage.setItem(workspaceStorageKey(ANALYSIS_KEY), model);
  } catch {
    /* private browsing — pref won't persist */
  }
}
