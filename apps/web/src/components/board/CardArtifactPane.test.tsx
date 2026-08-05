import { $convertFromMarkdownString } from "@lexical/markdown";
import { $isLinkNode } from "@lexical/link";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  artifactContentBottomPadding,
  artifactContentIsAvailable,
  artifactHasLoaded,
  createArtifactSaveCoordinator,
  refreshedArtifactMatchesSettledContent,
} from "./CardArtifactPane";
import {
  ARTIFACT_MARKDOWN_NODES,
  ARTIFACT_MARKDOWN_TRANSFORMERS,
  CardArtifactMarkdownEditor,
  createArtifactMarkdownCommitScheduler,
  serializeArtifactMarkdownEditorState,
} from "./CardArtifactMarkdownEditor";

describe("artifactContentBottomPadding", () => {
  it("reserves the measured composer height plus the document end gutter", () => {
    expect(artifactContentBottomPadding(144)).toBe(176);
    expect(artifactContentBottomPadding(280)).toBe(312);
  });
});

describe("artifactContentIsAvailable", () => {
  it("blocks an empty editor until the artifact loads but preserves an existing draft", () => {
    expect(artifactContentIsAvailable(false, null)).toBe(false);
    expect(artifactContentIsAvailable(true, null)).toBe(true);
    expect(artifactContentIsAvailable(false, "local draft")).toBe(true);
  });
});

describe("artifactHasLoaded", () => {
  it("requires artifact data without a load or refresh error", () => {
    expect(artifactHasLoaded(false, null)).toBe(false);
    expect(artifactHasLoaded(false, "load failed")).toBe(false);
    expect(artifactHasLoaded(true, "refresh failed")).toBe(false);
    expect(artifactHasLoaded(true, null)).toBe(true);
  });
});

describe("refreshedArtifactMatchesSettledContent", () => {
  it("releases a draft only when the refreshed content confirms the settled write", () => {
    expect(refreshedArtifactMatchesSettledContent("saved edit", "saved edit")).toBe(true);
    expect(refreshedArtifactMatchesSettledContent("external edit", "saved edit")).toBe(false);
    expect(refreshedArtifactMatchesSettledContent(null, "saved edit")).toBe(false);
    expect(refreshedArtifactMatchesSettledContent(undefined, "saved edit")).toBe(false);
  });
});

describe("artifact save coordination", () => {
  it("does not let an older write mark a newer edit as saved", () => {
    const coordinator = createArtifactSaveCoordinator("persisted");
    coordinator.markDirty();
    const firstWrite = coordinator.startWrite("first edit");
    coordinator.markDirty();

    expect(coordinator.finishWrite(firstWrite, "saved")).toBeNull();
  });

  it("keeps an optimistic no-op pending until its in-flight write succeeds", () => {
    const coordinator = createArtifactSaveCoordinator("persisted");
    coordinator.markDirty();
    const write = coordinator.startWrite("optimistic edit");
    coordinator.markDirty();

    expect(coordinator.settleNoop("optimistic edit")).toBeNull();
    expect(coordinator.finishWrite(write, "saved")).toBe("saved");
  });

  it("surfaces an in-flight failure after an optimistic no-op settles", () => {
    const coordinator = createArtifactSaveCoordinator("persisted");
    coordinator.markDirty();
    const write = coordinator.startWrite("optimistic edit");
    coordinator.markDirty();
    expect(coordinator.finishWrite(write, "error")).toBeNull();

    expect(coordinator.settleNoop("optimistic edit")).toBe("error");
  });

  it("stays saved when a duplicate write fails after the content was confirmed", () => {
    const coordinator = createArtifactSaveCoordinator("persisted");
    coordinator.markDirty();
    const firstWrite = coordinator.startWrite("same edit");
    coordinator.markDirty();
    const duplicateWrite = coordinator.startWrite("same edit");

    expect(coordinator.finishWrite(firstWrite, "saved")).toBeNull();
    expect(coordinator.finishWrite(duplicateWrite, "error")).toBe("saved");
  });

  it("waits for every queued write before reporting the latest content as saved", () => {
    const coordinator = createArtifactSaveCoordinator("persisted");
    coordinator.markDirty();
    const firstWrite = coordinator.startWrite("first edit");
    coordinator.markDirty();
    const latestWrite = coordinator.startWrite("latest edit");

    expect(coordinator.finishWrite(latestWrite, "saved")).toBeNull();
    expect(coordinator.finishWrite(firstWrite, "saved")).toBe("saved");
  });

  it("ignores server confirmation while an edit is dirty or in flight", () => {
    const coordinator = createArtifactSaveCoordinator("persisted");
    coordinator.markDirty();
    expect(coordinator.observeConfirmed("stale while dirty")).toBe(false);

    const write = coordinator.startWrite("local edit");
    expect(coordinator.observeConfirmed("stale while writing")).toBe(false);
    expect(coordinator.finishWrite(write, "saved")).toBe("saved");
    expect(coordinator.getConfirmedContent()).toBe("local edit");
  });

  it("adopts server confirmation when no local work is pending", () => {
    const coordinator = createArtifactSaveCoordinator("persisted");

    expect(coordinator.observeConfirmed("server edit")).toBe(true);
    coordinator.markDirty();
    expect(coordinator.settleNoop("server edit")).toBe("saved");
  });

  it("requires a reverting write while an optimistic write is still in flight", () => {
    const coordinator = createArtifactSaveCoordinator("persisted");
    coordinator.markDirty();
    const optimisticWrite = coordinator.startWrite("optimistic edit");
    coordinator.markDirty();

    expect(coordinator.canSettle("persisted")).toBe(false);
    const revertingWrite = coordinator.startWrite("persisted");
    expect(coordinator.finishWrite(optimisticWrite, "saved")).toBeNull();
    expect(coordinator.finishWrite(revertingWrite, "saved")).toBe("saved");
  });

  it("keeps failed content retryable instead of treating it as persisted", () => {
    const coordinator = createArtifactSaveCoordinator("persisted");
    coordinator.markDirty();
    const write = coordinator.startWrite("failed edit");

    expect(coordinator.finishWrite(write, "error")).toBe("error");
    expect(coordinator.canSettle("failed edit")).toBe(false);
  });
});

describe("CardArtifactMarkdownEditor", () => {
  it("renders an in-place rich editor instead of a raw Markdown textarea", () => {
    const markup = renderToStaticMarkup(
      <CardArtifactMarkdownEditor
        value="# Issue brief — DEV-24"
        fileName="Brief.md"
        isPersistedValue={() => true}
        onDirty={() => undefined}
        onCommit={() => undefined}
        onSettled={() => undefined}
      />,
    );

    expect(markup).toContain('contentEditable="true"');
    expect(markup).toContain('aria-label="Brief.md contents"');
    expect(markup).not.toContain("<textarea");
  });

  it("round-trips the issue-brief Markdown constructs used by flow artifacts", () => {
    const input = [
      "# Issue brief — DEV-24",
      "",
      "**Identifier:** DEV-24",
      "**URL:** https://linear.app/example",
      "**Docs:** https://example.com/path_(part)",
      "",
      "- [x] preserves checklists",
      "- preserves **bold** list content",
      "- preserves [links](https://example.com)",
    ].join("\n");
    const editor = createEditor({
      namespace: "artifact-markdown-round-trip-test",
      nodes: ARTIFACT_MARKDOWN_NODES,
      onError: (error) => {
        throw error;
      },
    });

    editor.update(
      () => {
        $convertFromMarkdownString(input, ARTIFACT_MARKDOWN_TRANSFORMERS, undefined, true);
      },
      { discrete: true },
    );

    const output = serializeArtifactMarkdownEditorState(editor.getEditorState());
    const bareUrlIsRenderedAsLink = editor.getEditorState().read(() => {
      const urlText = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === "https://linear.app/example");
      return $isLinkNode(urlText?.getParent());
    });
    const markdownLink = editor.getEditorState().read(() => {
      const linkText = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === "links");
      const linkNode = linkText?.getParent();
      return $isLinkNode(linkNode)
        ? { text: linkNode.getTextContent(), url: linkNode.getURL() }
        : null;
    });
    const balancedUrlIsRenderedAsLink = editor.getEditorState().read(() => {
      const urlText = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === "https://example.com/path_(part)");
      return $isLinkNode(urlText?.getParent());
    });
    expect(output).toContain("# Issue brief — DEV-24");
    expect(output).toContain("**Identifier:** DEV-24");
    expect(output).toContain("**URL:** https://linear.app/example");
    expect(output).toContain("**Docs:** https://example.com/path_(part)");
    expect(output).toContain("- [x] preserves checklists");
    expect(output).toContain("- preserves **bold** list content");
    expect(output).toContain("[links](https://example.com)");
    expect(bareUrlIsRenderedAsLink).toBe(true);
    expect(balancedUrlIsRenderedAsLink).toBe(true);
    expect(markdownLink).toEqual({ text: "links", url: "https://example.com" });
  });

  it("serializes rich editor mutations back to Markdown", () => {
    const editor = createEditor({
      namespace: "artifact-markdown-edit-test",
      nodes: ARTIFACT_MARKDOWN_NODES,
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        const note = $createTextNode("Added review note");
        note.toggleFormat("bold");
        $getRoot().append($createParagraphNode().append(note));
      },
      { discrete: true },
    );

    expect(serializeArtifactMarkdownEditorState(editor.getEditorState())).toBe(
      "**Added review note**",
    );
  });

  it("defers whole-document serialization until the edit settles", () => {
    const editor = createEditor({
      namespace: "artifact-markdown-debounce-test",
      nodes: ARTIFACT_MARKDOWN_NODES,
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode("Latest content")));
      },
      { discrete: true },
    );
    const scheduledCommits: Array<() => void> = [];
    let dirtyCount = 0;
    const commits: string[] = [];
    const scheduler = createArtifactMarkdownCommitScheduler({
      clock: {
        setTimeout: (callback) => {
          scheduledCommits.push(callback);
          return 1;
        },
        clearTimeout: () => {
          scheduledCommits.shift();
        },
      },
      isCurrent: () => false,
      onDirty: () => {
        dirtyCount += 1;
      },
      onCommit: (value) => commits.push(value),
      onSettled: () => undefined,
    });

    scheduler.schedule(editor.getEditorState());
    scheduler.schedule(editor.getEditorState());
    expect(dirtyCount).toBe(1);
    expect(commits).toEqual([]);
    expect(scheduledCommits).toHaveLength(1);

    scheduledCommits[0]?.();
    expect(commits).toEqual(["Latest content"]);
  });

  it("settles without writing when an edit returns to the persisted Markdown", () => {
    const editor = createEditor({
      namespace: "artifact-markdown-noop-test",
      nodes: ARTIFACT_MARKDOWN_NODES,
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode("Persisted content")));
      },
      { discrete: true },
    );
    const commits: string[] = [];
    let settled = false;
    const scheduler = createArtifactMarkdownCommitScheduler({
      clock: {
        setTimeout: () => 1,
        clearTimeout: () => undefined,
      },
      isCurrent: (value) => value === "Persisted content",
      onDirty: () => undefined,
      onCommit: (value) => commits.push(value),
      onSettled: () => {
        settled = true;
      },
    });

    scheduler.schedule(editor.getEditorState());
    scheduler.flush();
    expect(commits).toEqual([]);
    expect(settled).toBe(true);
  });
});
