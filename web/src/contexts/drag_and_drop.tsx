import React, { useState, ReactNode, useRef } from "react";
import ReactDOM from "react-dom";
import styled, { useTheme } from "styled-components";

import { assertSome, assert, platformModifierKey } from "utils";
import { ClientOffset } from "geometry";
import { useDocumentEvent } from "hooks";
import Expr from "expr";
import layoutExpr from "expr_view/layout";

const Overlay = styled.div`
    width: 100%;
    height: 100%;
    position: fixed;
    z-index: 1000;
`;

const Container = styled.div`
    position: absolute;
    background: ${(p) => p.theme.colour.background};
    box-shadow: ${(p) => p.theme.shadow.normal};
    padding: ${(p) => p.theme.exprList.padding.combine(p.theme.highlight.padding).css};
    border-radius: ${(p) => p.theme.exprList.borderRadius}px;
    box-sizing: content-box;
    padding: ${(p) => p.theme.exprView.frozenPadding.css};
`;

export interface DropListener {
    /** Fires to give a listener an opportunity to show that a drop is accepted. */
    dragUpdate(point: ClientOffset | null): void;
    /** Fires when the dragged object moves. Should return if this listener accepted the drop. If
     * move is returned, the draggedOut listener on the expr that begun the drag is not caleld */
    acceptDrop(point: ClientOffset, expr: Expr): "copy" | "move" | "reject";
}

export interface MaybeStartDrag {
    start: ClientOffset; // Where the maybe-drag started.
    exprStart: ClientOffset; // Where is the corner of the expr.
    /** Called when the drag status changes. */
    onDragUpdate?(willMove: boolean): void;
    /** Called if the drag is accepted. This is almost always the case except when copying. */
    onDragAccepted?(): void;
    /** Called when the drag concludes, no matter the acceptance status. */
    onDragEnd?(): void;
    expr: Expr;
}

export interface DragAndDropContext {
    /** Possibly start a drag */
    maybeStartDrag(maybeDrag: MaybeStartDrag): void;
    addListener(listener: DropListener): void;
    removeListener(listener: DropListener): void;
}

const DragAndDrop = React.createContext<DragAndDropContext | null>(null);
export default DragAndDrop;

interface DraggingState extends MaybeStartDrag {
    delta: ClientOffset | null; // How much to offset the expr when showing the drag.
}

// There are three states to a drag.
// 1. Not dragging - drag and state.position is null.
// 2. Maybe-drag - drag is now initialised, except for delta.
// 3. Drag - Delta is now initialised, state.position follows the mouse.
export function DragAndDropSurface({ children }: { children: ReactNode }) {
    const theme = useTheme();
    const [position, setPosition] = useState<ClientOffset | null>(null);
    const listeners = useRef(new Set<DropListener>()).current;
    const drag = useRef<DraggingState | null>(null);
    const [willMove, setWillMove] = useState(false);

    useDocumentEvent("mousemove", onMouseMove);
    useDocumentEvent("keydown", (e) => {
        if (e.key === platformModifierKey()) {
            setWillMove(false);
            drag.current?.onDragUpdate?.(false);
        }
    });
    useDocumentEvent("keyup", (e) => {
        if (e.key === platformModifierKey()) {
            setWillMove(true);
            drag.current?.onDragUpdate?.(true);
        }
    });

    const contextValue = useRef<DragAndDropContext>({
        maybeStartDrag(maybeDrag: MaybeStartDrag) {
            drag.current = { ...maybeDrag, delta: null };
        },
        addListener(listener) {
            listeners.add(listener);
        },
        removeListener(listener) {
            listeners.delete(listener);
        },
    }).current;

    function dismissDrag() {
        // Note this calls both .drop and then .update on the listeners.
        if (drag.current !== null && drag.current.delta !== null) {
            const exprCorner = assertSome(position).offset(drag.current.delta);
            const expr = drag.current.expr;
            for (const listener of listeners) {
                const status = listener.acceptDrop(exprCorner, expr);
                if (status === "reject") continue;
                if (status === "move" && willMove) drag.current.onDragAccepted?.();
                break;
            }
            drag.current.onDragEnd?.();
        }
        drag.current = null;
        // Premature optimisation. This method is called on every other mouse move.
        if (position !== null) {
            listeners.forEach((f) => f.dragUpdate(null));
            setPosition(null);
        }
    }

    function onMouseMove(event: MouseEvent) {
        event.preventDefault();
        // Ensure left mouse button is held down.
        if (event.buttons !== 1 || drag.current === null) {
            dismissDrag();
            return;
        }

        const DRAG_THRESHOLD = 4; // Based on Windows default, DragHeight registry.
        const nextPosition = ClientOffset.fromClient(event);
        if (drag.current.delta === null) {
            // Consider starting a drag.
            if (drag.current.start.distance(nextPosition) > DRAG_THRESHOLD) {
                drag.current.delta = drag.current.exprStart.difference(nextPosition);
                drag.current.onDragUpdate?.(true);
                setPosition(nextPosition);
                setWillMove(true);
            }
        } else {
            // Update the drag.
            setPosition(nextPosition);
            const exprCorner = nextPosition.offset(drag.current.delta);
            listeners.forEach((x) => x.dragUpdate(exprCorner));
        }
    }

    function renderExpr() {
        assert(drag.current?.delta != null);
        const pos = assertSome(position).offset(drag.current.delta);
        const { nodes, size } = layoutExpr(theme, drag.current.expr);
        return (
            // Cover the entire page in a div so we can always get the mouseUp event.
            // Bug: Safari doesn't like drawing box-shadows on SVGs (it leaves a ghost trail), it
            // must be drawn on the Container div instead.
            <Overlay onMouseUp={dismissDrag} style={{ cursor: willMove ? "grabbing" : "copy" }}>
                <Container style={{ top: pos.y, left: pos.x }}>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width={size.width}
                        height={size.height}
                        // Prevent weird white-space spacing issues.
                        display="block"
                    >
                        {nodes}
                    </svg>
                </Container>
            </Overlay>
        );
    }

    let surface: React.ReactNode;
    if (drag.current?.delta != null) {
        surface = ReactDOM.createPortal(renderExpr(), document.body);
    }

    // Declare the global droppable filter here once.
    return (
        <DragAndDrop.Provider value={contextValue}>
            {surface}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="0"
                height="0"
                style={{ position: "absolute" }}
            >
                <filter id="droppable">
                    <feDropShadow
                        dx="0"
                        dy="0"
                        stdDeviation={theme.droppable.radius / 2}
                        floodColor={theme.droppable.colour}
                    />
                </filter>
            </svg>
            {children}
        </DragAndDrop.Provider>
    );
}
