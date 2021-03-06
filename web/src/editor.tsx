import { useTheme } from "styled-components";
import React, { Ref, PureComponent } from "react";
import { useDispatch } from "react-redux";

import * as E from "expr";
import * as Select from "selection";
import {
    arrayEquals,
    assert,
    assertSome,
    eventHasUnwantedModifiers,
    insertSibling,
    makeMutableRef,
    reverseObject,
} from "utils";
import { KaleTheme, Highlight } from "theme";
import { ClientOffset } from "geometry";
import { useContextChecked } from "hooks";
import Expr, { ExprId } from "expr";
import ExprView, { ExprAreaMap, OnDropMode } from "expr_view";

import { Type, Func, assertFunc, Value, Builtin } from "vm/types";
import { specialFunctions } from "vm/interpreter";

import { useSelector } from "state/root";
import Clipboard from "state/clipboard";
import Workspace, { WorkspaceValue } from "state/workspace";

import EditorStack, { EditorStackContext } from "contexts/editor_stack";

import ContextMenu, { ContextMenuItem } from "components/context_menu";
import InlineEditor from "components/inline_editor";

interface EditorState {
    foldingComments: boolean;
    editing: { expr: ExprId; created: boolean } | null;
    showingDebugOverlay: boolean;
    showInlineParens: boolean;
    screenshotMode: boolean;
    blankPopover: ExprId | null;
    // Highlights.
    selection: ExprId;
    hoverHighlight: ExprId | null;
    droppable: ExprId | null;
}

interface EditorWrapperProps {
    focused: boolean;
    functionName: string;
}

interface EditorProps extends EditorWrapperProps {
    onCopy(expr: Expr): void;
    onPaste(ix: number): Expr | null;
    onEnsureExists(name: string): void;
    onUpdate(name: string, updater: (expr: Expr) => Expr): void;
    workspace: WorkspaceValue;
    editorStack: EditorStackContext;
    theme: KaleTheme;
    forwardedRef: Ref<HTMLDivElement>;
}

class Editor extends PureComponent<EditorProps, EditorState> {
    private readonly containerRef = React.createRef<HTMLDivElement>();
    private readonly exprAreaMapRef = makeMutableRef<ExprAreaMap>();

    state: EditorState = {
        foldingComments: false,
        editing: null,
        blankPopover: null,
        // Hidden debug stuffs.
        showingDebugOverlay: false,
        showInlineParens: false,
        screenshotMode: false,
        // Highlights.
        selection: this.expr.id,
        hoverHighlight: null,
        droppable: null,
    };

    private get expr(): Expr {
        return this.getWorkspaceFunc(this.props.workspace, this.props.functionName);
    }

    // Editor internal APIs.
    private update(childId: ExprId | null, transform: (expr: Expr) => Expr | null) {
        function updater(main: Expr) {
            const nextMain = main.update(childId ?? main.id, transform);
            return nextMain ?? new E.Blank(E.exprData("Double Tap Me"));
        }
        this.props.onUpdate(this.props.functionName, updater);
    }

    private getWorkspaceValue(
        workspace: WorkspaceValue,
        name: string,
    ): Value<Builtin | Func> | undefined {
        return workspace.scope.get(name);
    }

    private getWorkspaceFunc(workspace: WorkspaceValue, name: string): Expr {
        return assertFunc(assertSome(this.getWorkspaceValue(workspace, name))).expr;
    }

    private addToClipboard(expr: ExprId) {
        this.props.onCopy(this.expr.get(expr));
    }

    private removeExpr(sel: ExprId) {
        this.update(sel, () => null);
    }

    private replaceExpr(old: ExprId, next: Expr) {
        this.update(old, () => next.resetIds().replaceId(old));
    }

    private createInlineEditor(expr: Expr, created: boolean) {
        if (expr === null) return;
        // Only things with a value can be edited.
        if (expr.value() !== null) {
            this.setState({ editing: { expr: expr.id, created } });
        } else if (expr instanceof E.Blank) {
            this.setState({ blankPopover: expr.id });
        }
    }

    private stopEditing(newValue: string | null) {
        // This will disable rendering the inline-editor, preventing it from firing onBlur.
        this.setState({ editing: null }, () => this.focus());

        const { expr: exprId, created } = assertSome(this.state.editing);
        const expr = this.expr.findId(exprId);
        const value = newValue ?? expr?.value();
        if (!value) {
            // If empty (or null for some reason).
            this.replaceExpr(exprId, new E.Blank());
            return;
        }
        this.update(exprId, (x) => x.withValue(value));

        if (created && expr instanceof E.Call) {
            // Auto-insert the right amount of blanks for this function.
            // Note at this point expr still might have some old value.
            const func = this.getWorkspaceValue(this.props.workspace, value)?.value;
            if (func !== undefined && !specialFunctions.has(value) && func.args.length > 0) {
                const blanks = (func.args as (string | null)[]).map(
                    (x) => new E.Blank(E.exprData(x)),
                );
                blanks.forEach((arg) => this.insertAsChildOf(exprId, arg, true));
                this.selectExpr(blanks[0].id);
            }
        } else if (expr !== null && newValue !== null) {
            // Auto-select the next pre-order sibling (if we submitted).
            this.selectionAction(Select.rightSmart)();
        }
    }

    private replaceAndEdit(prevId: ExprId, next: Expr, created: boolean) {
        // We cannot use the .replace here because we need the next expr for creating the editor.
        const nextWithPrevId = next.resetIds().replaceId(prevId);
        this.update(prevId, () => nextWithPrevId);
        //TODO: Don't do this.
        // Please forgive me. Make sure the editor is created with the area information for the
        // correct expr type.
        setTimeout(() => {
            this.createInlineEditor(nextWithPrevId, created);
        }, 100);
    }

    private insertBlankAsSiblingOf(target: ExprId, right: boolean) {
        this.selectAndInsertAsSiblingOf(target, new E.Blank(), right);
    }

    // Complex functions.
    private insertAsChildOf(target: ExprId, toInsert: Expr, last: boolean): void {
        this.update(target, (parent) => {
            if (parent.hasChildren()) {
                return parent.updateChildren((xs) =>
                    last ? [...xs, toInsert] : [toInsert, ...xs],
                );
            }
            return parent;
        });
    }

    private selectAndInsertAsSiblingOf(sibling: ExprId, toInsert: Expr, right: boolean): void {
        this.selectExpr(toInsert.id);
        this.update(null, (mainExpr) => {
            const parent = mainExpr.parentOf(sibling);
            if (parent == null) {
                return new E.List(right ? [mainExpr, toInsert] : [toInsert, mainExpr]);
            } else if (parent.hasChildren()) {
                return mainExpr.replace(
                    parent.id,
                    parent.updateChildren((xs) =>
                        insertSibling(xs, (x) => x.id === sibling, toInsert, right),
                    ),
                );
            } else {
                return mainExpr;
            }
        });
    }

    private insertNewLine(target: ExprId, below: boolean): void {
        const toInsert = new E.Blank();
        this.update(target, (expr) => {
            if (expr instanceof E.List) {
                return new E.List(
                    below ? [...expr.list, toInsert] : [toInsert, ...expr.list],
                    expr.data,
                );
            }
            // This becomes very simple with automatic list merging.
            return new E.List(below ? [expr, toInsert] : [toInsert, expr]);
        });
        this.selectExpr(toInsert.id);
    }

    /** Move an expr one level of nesting up. Barf in the LISP parlance. */
    private barfUp(exprId: ExprId): void {
        const expr = this.expr.get(exprId);
        const parent = this.expr.parentOf(exprId);
        if (parent !== null) {
            // Do not stack top-level lists.
            if (this.expr.parentOf(parent.id) == null && this.expr instanceof E.List) {
                return;
            }
            this.removeExpr(exprId);
            this.selectAndInsertAsSiblingOf(parent.id, expr, true);
        }
    }

    // Actions.
    private selectionAction(reducer: Select.SelectFn): () => void {
        return () =>
            this.setState((state) => ({
                selection:
                    reducer(this.expr, state.selection, assertSome(this.exprAreaMapRef.current)) ??
                    state.selection,
            }));
    }

    private pasteAction(ix: number): () => void {
        return () => {
            const paste = this.props.onPaste(ix);
            if (paste !== null) {
                this.replaceExpr(this.state.selection, paste);
            }
        };
    }

    private readonly openEditor = (target: ExprId) => {
        const selected = this.expr.findId(target);
        if (selected instanceof E.Call) {
            this.props.onEnsureExists(selected.fn);
            this.props.editorStack.openEditor(selected.fn);
        }
    };

    private readonly smartSpace = (targetId: ExprId) => {
        const expr = this.expr.get(targetId);
        if (expr instanceof E.Blank) {
            this.barfUp(targetId);
        } else if (expr instanceof E.Call || expr instanceof E.List) {
            const toInsert = new E.Blank();
            this.insertAsChildOf(targetId, toInsert, false);
            this.selectExpr(toInsert.id);
        } else {
            this.insertBlankAsSiblingOf(targetId, true);
        }
    };

    private readonly actions = {
        delete: (e: ExprId) => this.removeExpr(e),
        replace: (e: ExprId) => this.replaceExpr(e, new E.Blank()),
        move: (e: ExprId) => {
            this.addToClipboard(e);
            this.removeExpr(e);
        },
        shuffle: (e: ExprId) => {
            this.addToClipboard(e);
            this.replaceExpr(e, new E.Blank());
        },
        copy: (e: ExprId) => this.addToClipboard(e),
        insert: (e: ExprId) => this.insertBlankAsSiblingOf(e, true),
        insertBefore: (e: ExprId) => this.insertBlankAsSiblingOf(e, false),
        foldComments: () => this.setState((state) => ({ foldingComments: !state.foldingComments })),
        comment: (e: ExprId) => {
            // Empty string _should_ be null.
            const comment = prompt("Comment?", this.expr.get(e).data.comment ?? "") || null;
            this.update(e, (expr) => expr.assignToData({ comment: comment }));
        },
        disable: (e: ExprId) => {
            this.update(e, (expr) => {
                if (expr instanceof E.Blank) return expr;
                return expr.assignToData({ disabled: !expr.data.disabled });
            });
        },
        edit: (e: ExprId) => this.startEditing(e),
        openEditor: (e: ExprId) => this.openEditor(e),
        newLine: (e: ExprId) => this.insertNewLine(e, true),
        newLineBefore: (e: ExprId) => this.insertNewLine(e, false),
        moveToParent: (e: ExprId) => {
            const parent = this.expr.parentOf(e);
            if (parent !== null) {
                this.replaceExpr(parent.id, new E.List(parent.children()));
            }
        },
        smartMakeCall: (e: ExprId) => {
            const target = this.expr.get(e);
            if (target instanceof E.Blank) {
                this.replaceAndEdit(e, new E.Call(""), true);
            } else {
                const fn = new E.Call("", [target]);
                this.replaceAndEdit(e, fn, false);
            }
        },
        barfUp: (e: ExprId) => this.barfUp(e),
        smartSpace: (e: ExprId) => this.smartSpace(e),
        // Demo things that should be moved to the toy-box.
        demoAddVariable: (e: ExprId) => this.replaceAndEdit(e, new E.Variable(""), true),
        demoAddString: (e: ExprId) => this.replaceAndEdit(e, new E.Literal("", Type.Text), true),
        demoAddNumber: (e: ExprId) => this.replaceAndEdit(e, new E.Literal("", Type.Num), true),
        showDebugOverlay: () =>
            this.setState({ showingDebugOverlay: !this.state.showingDebugOverlay }),
        toggleInlineParens: () => this.setState({ showInlineParens: !this.state.showInlineParens }),
        toggleScreenshotMode: () => this.setState({ screenshotMode: !this.state.screenshotMode }),
    };

    // See https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values.
    // Keep these sorted.
    private readonly menuKeyEquivalents: { [key: string]: keyof Editor["actions"] } = {
        " ": "smartSpace",
        "\\": "disable",
        "#": "foldComments",
        Backspace: "delete",
        c: "copy",
        Enter: "edit",
        F: "moveToParent",
        f: "smartMakeCall",
        g: "demoAddString",
        i: "insert",
        I: "insertBefore",
        m: "demoAddNumber",
        n: "newLine",
        N: "newLineBefore",
        o: "openEditor",
        P: "barfUp", // Like the parent motion but actually do something.
        q: "comment",
        r: "replace",
        s: "shuffle",
        v: "demoAddVariable",
        x: "move",
    };

    // The shortcuts only accessible from the keyboard.
    // Keep these sorted.
    private readonly editorShortcuts: { [key: string]: (sel: ExprId) => void } = {
        "0": this.pasteAction(9),
        "1": this.pasteAction(0),
        "2": this.pasteAction(1),
        "3": this.pasteAction(2),
        "4": this.pasteAction(3),
        "5": this.pasteAction(4),
        "6": this.pasteAction(5),
        "7": this.pasteAction(6),
        "8": this.pasteAction(7),
        "9": this.pasteAction(9),
        ArrowDown: this.selectionAction(Select.downSmart),
        ArrowLeft: this.selectionAction(Select.leftSmart),
        ArrowRight: this.selectionAction(Select.rightSmart),
        ArrowUp: this.selectionAction(Select.upSmart),
        d: this.actions["delete"], // An alternative to the Backspace
        e: this.actions["edit"], // An alternative to the Enter
        H: this.selectionAction(Select.leftSiblingSmart),
        h: this.selectionAction(Select.leftSmart),
        j: this.selectionAction(Select.downSmart),
        k: this.selectionAction(Select.upSmart),
        L: this.selectionAction(Select.rightSiblingSmart),
        l: this.selectionAction(Select.rightSmart),
        p: this.selectionAction(Select.parent),
        Tab: this.selectionAction(Select.nextBlank),
    };

    //TODO: Ideally the names would also be dynamic.
    private readonly enableForCalls = (expr: Expr) => expr instanceof E.Call;
    private readonly disableForBlanks = (expr: Expr) => !(expr instanceof E.Blank);
    private readonly disableForTopLevel = (expr: Expr) => expr.id !== this.expr.id;

    private readonly exprMenu: (null | {
        label: string;
        action: keyof Editor["actions"];
        enabled?(expr: Expr): boolean;
        hidden?: boolean;
    })[] = [
        { action: "copy", label: "Copy" },
        { action: "edit", label: "Edit..." },
        {
            action: "smartSpace",
            label: "Add Space or Move Space Up",
            enabled: this.disableForTopLevel,
        },
        { action: "openEditor", label: "Open definition", enabled: this.enableForCalls },
        { action: "barfUp", label: "Move Up", enabled: this.disableForTopLevel },
        { action: "showDebugOverlay", label: "Toggle the Debug Overlay", hidden: true },
        { action: "toggleInlineParens", label: "Toggle the Inline Parentheses", hidden: true },
        { action: "toggleScreenshotMode", label: "Toggle Screenshot Mode", hidden: true },
        null,
        { action: "delete", label: "Delete" },
        { action: "move", label: "Cut" },
        { action: "replace", label: "Delete and Add Space" },
        { action: "shuffle", label: "Cut and Add Space" },
        null,
        { action: "newLine", label: "New Line Below" },
        { action: "newLineBefore", label: "New Line Above" },
        { action: "insert", label: "New Argument Before", enabled: this.enableForCalls },
        { action: "insertBefore", label: "New Argument After", enabled: this.enableForCalls },
        null,
        { action: "comment", label: "Comment..." },
        { action: "disable", label: "Disable", enabled: this.disableForBlanks },
        null,
        { action: "demoAddVariable", label: "Make a Variable..." },
        { action: "demoAddString", label: "Make a String..." },
        { action: "demoAddNumber", label: "Make a Number..." },
        { action: "smartMakeCall", label: "Turn Into a Function Call..." },
        { action: "moveToParent", label: "Replace the Parent", enabled: this.disableForTopLevel },
    ];

    // Bound methods.
    private readonly menuKeyEquivalentForAction = reverseObject(this.menuKeyEquivalents);
    onContextMenu = (exprId: ExprId): ContextMenuItem[] => {
        const expr = this.expr.get(exprId);
        return this.exprMenu.map((item, i) => ({
            id: item?.action ?? i.toString(),
            label: item?.label,
            action: item?.action && (() => this.actions[item.action](exprId)),
            keyEquivalent: item?.action && this.menuKeyEquivalentForAction[item.action],
            disabled: !(item?.enabled?.(expr) ?? true),
            hidden: item?.hidden,
        }));
    };

    private readonly keyDown = (event: React.KeyboardEvent) => {
        if (eventHasUnwantedModifiers(event)) return;
        const key = event.key;
        if (Object.prototype.hasOwnProperty.call(this.menuKeyEquivalents, key)) {
            this.actions[this.menuKeyEquivalents[key]](this.state.selection);
        } else if (Object.prototype.hasOwnProperty.call(this.editorShortcuts, key)) {
            this.editorShortcuts[key](this.state.selection);
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    private readonly selectExpr = (selection: ExprId) => {
        this.setState({ selection });
    };

    private readonly onHover = (hoverHighlight: ExprId | null) => {
        this.setState({ hoverHighlight });
    };

    private readonly startEditing = (expr: ExprId) => {
        this.createInlineEditor(this.expr.get(expr), false);
    };

    private readonly focus = () => {
        this.containerRef.current?.focus();
    };

    // This seems messy but it's the only way https://github.com/facebook/react/issues/13029
    private readonly attachRef = (element: HTMLDivElement | null) => {
        if (element === null) return;
        (this.containerRef as React.MutableRefObject<HTMLDivElement>).current = element;
        const { forwardedRef } = this.props;
        if (typeof forwardedRef === "function") {
            forwardedRef(element);
        } else if (forwardedRef != null) {
            (forwardedRef as React.MutableRefObject<HTMLDivElement>).current = element;
        }
    };

    private readonly onDraggedOut = (exprId: ExprId) => {
        this.removeExpr(exprId);
    };

    private readonly onDropped = (mode: OnDropMode, at: ExprId, expr: Expr) => {
        switch (mode) {
            case "replace":
                this.replaceExpr(at, expr);
                this.selectExpr(expr.id);
                break;
            case "sibling":
                this.selectAndInsertAsSiblingOf(at, expr, true);
                break;
            case "child":
                this.insertAsChildOf(at, expr, false);
                this.selectExpr(expr.id);
                break;
        }
        this.focus();
    };

    componentDidUpdate(prevProps: EditorProps, prevState: EditorState) {
        assert(
            prevProps.functionName === this.props.functionName,
            "Use a key to create a new Editor component instead",
        );
        if (this.expr.contains(this.state.selection)) return;
        // Ensure the selection is always valid.
        const prevExpr = this.getWorkspaceFunc(prevProps.workspace, prevProps.functionName);
        const candidates: Expr[][] = [];

        // Maybe we just tried updating the selection to something that doesn't exist. Use the
        // old selection instead.
        const oldSelection = prevExpr.findId(prevState.selection);
        if (oldSelection !== null) {
            candidates.push([oldSelection]);
        }
        // Try the siblings, going forward then back.
        const [siblings, ix] = prevExpr.siblings(this.state.selection);
        if (ix !== null) {
            candidates.push(siblings.slice(ix + 1));
            candidates.push(siblings.slice(0, ix).reverse());
        }
        // Finally consider all the parents.
        candidates.push(prevExpr.parents(this.state.selection));
        for (const option of candidates.flat()) {
            if (this.expr.contains(option.id)) {
                this.selectExpr(option.id);
                return;
            }
        }
        this.selectExpr(this.expr.id); // Last resort.
    }

    constructor(props: EditorProps) {
        super(props);
        for (const shortcut of Object.keys(this.menuKeyEquivalents)) {
            assert(!(shortcut in this.editorShortcuts), "Shortcut conflict");
        }
        assert(!specialFunctions.has(props.functionName), "Cannot edit special functions");
    }

    private renderInlineEditor() {
        if (this.exprAreaMapRef.current === null || this.state.editing === null) return;
        const exprId = this.state.editing.expr;
        const expr = this.expr.get(exprId);
        return (
            <InlineEditor
                exprArea={this.exprAreaMapRef.current[exprId]}
                value={assertSome(expr.value())}
                disableSuggestions={!(expr instanceof E.Call)}
                onChange={(value) => {
                    this.update(exprId, (x) => x.withValue(value));
                }}
                onDismiss={() => this.stopEditing(null)}
                onSubmit={(value) => this.stopEditing(value)}
            />
        );
    }

    private renderBlankPopover() {
        const target = this.state.blankPopover;
        if (
            target === null ||
            this.exprAreaMapRef.current === null ||
            this.containerRef.current === null
        ) {
            return;
        }
        const exprRect = this.exprAreaMapRef.current[target].rect;
        const editorOrigin = ClientOffset.fromBoundingRect(
            this.containerRef.current.getBoundingClientRect(),
        );
        const origin = editorOrigin.offset(exprRect.bottomMiddle);

        const exprs = [
            { label: "Function Call", expr: new E.Call(""), keyEquivalent: "f" },
            { label: "Variable", expr: new E.Variable(""), keyEquivalent: "v" },
            { label: "Text", expr: new E.Literal("", Type.Text), keyEquivalent: "g" },
            { label: "Number", expr: new E.Literal("", Type.Num), keyEquivalent: "m" },
        ];

        return (
            <ContextMenu
                popover
                origin={origin}
                onDismissMenu={() => {
                    this.focus();
                    this.setState({ blankPopover: null });
                }}
                items={exprs.map((x) => ({
                    id: x.label,
                    label: x.label,
                    action: () => this.replaceAndEdit(target, x.expr, true),
                    keyEquivalent: x.keyEquivalent,
                }))}
            />
        );
    }

    lastHighlights: [ExprId, Highlight][] = [];
    memoizedHighlights(): [ExprId, Highlight][] {
        const highlights: [ExprId, Highlight][] = [];
        const hl = this.props.theme.highlight;
        // Highlights pushed later have higher priority.
        if (this.state.hoverHighlight !== null && !this.state.screenshotMode) {
            highlights.push([this.state.hoverHighlight, hl.hover]);
        }
        // Preferablly this would be above the hover-highlight, but the blank hover-highlight has a
        // solid background, which would cover the blue-selection effect.
        if (!this.state.screenshotMode) {
            highlights.push([this.state.selection, hl.selection]);
        }
        if (this.state.blankPopover !== null) {
            highlights.push([this.state.blankPopover, hl.contextMenu]);
        }

        // Remove higlights that do not exist. Iterating backwards makes this easy.
        for (let i = highlights.length - 1; i >= 0; --i) {
            if (!this.expr.contains(highlights[i][0])) highlights.splice(i, 1);
        }
        // Sort the highlights by their containment.
        const lut: { [id in ExprId]: Expr } = {};
        for (const pair of highlights) {
            lut[pair[0]] = this.expr.get(pair[0]);
        }
        highlights.sort((lhs, rhs) => {
            if (lhs[0] === rhs[0]) return 0;
            return lut[lhs[0]].contains(rhs[0]) ? -1 : 1;
        });

        // Droppable highlight goes on last. Otherwise the shadow might clip other highlights.
        if (this.state.droppable !== null) {
            highlights.push([this.state.droppable, hl.droppable]);
        }
        if (arrayEquals(highlights, this.lastHighlights)) return this.lastHighlights;
        this.lastHighlights = highlights;
        return highlights;
    }

    render() {
        return (
            <div
                onKeyDown={this.keyDown}
                tabIndex={0}
                ref={this.attachRef}
                // Needed for positioning the inline editor.
                style={{
                    position: "relative",
                    width: "max-content",
                    margin: this.state.screenshotMode ? 100 : 0,
                }}
            >
                <ExprView
                    widePadding
                    // This is heavy pure component, don't create new objects here.
                    expr={this.expr}
                    highlights={this.memoizedHighlights()}
                    focused={this.props.focused}
                    foldComments={this.state.foldingComments}
                    exprAreaMapRef={this.exprAreaMapRef}
                    showDebugOverlay={this.state.showingDebugOverlay}
                    showInlineParens={this.state.showInlineParens}
                    // Callbacks.
                    onContextMenu={this.onContextMenu}
                    onClick={this.selectExpr}
                    onHover={this.onHover}
                    onDoubleClick={this.startEditing}
                    onMiddleClick={this.openEditor}
                    onFocus={this.focus}
                    onDraggedOut={this.onDraggedOut}
                    onDrop={this.onDropped}
                />
                {this.renderInlineEditor()}
                {this.renderBlankPopover()}
            </div>
        );
    }
}

export default React.forwardRef(function EditorWrapper(
    props: EditorWrapperProps,
    ref: Ref<HTMLDivElement>,
) {
    const dispatch = useDispatch();
    const clipboard = useSelector((x) => x.clipboard);
    const workspace = useSelector((x) => x.workspace);
    return (
        <Editor
            {...props}
            onCopy={(expr) => dispatch(Clipboard.actions.add({ expr, pinned: false }))}
            onPaste={(ix) => {
                if (ix < clipboard.length) {
                    const expr = clipboard[ix].expr;
                    dispatch(Clipboard.actions.use(expr.id));
                    return expr;
                }
                return null;
            }}
            onEnsureExists={(name) => dispatch(Workspace.actions.ensureExists({ name }))}
            onUpdate={(name, updater) => dispatch(Workspace.actions.update({ name, updater }))}
            workspace={workspace}
            editorStack={useContextChecked(EditorStack)}
            theme={useTheme()}
            forwardedRef={ref}
        />
    );
});
