import React from "react";
import styled from "styled-components";
import { motion } from "framer-motion";

import THEME, { ThemeType } from "theme";
import { Optional, max } from "utils";
import { Vec, Size, Rect } from "geometry";
import Expr, { ExprId, ExprVisitor } from "expr";
import * as E from "expr";
import TextMetrics from "text_metrics";

import { Layout, hstack, vstack, Area } from "expr_view/core";
import { UnderlineLine, SvgLine, HitBox, HoverHitBox } from "expr_view/components";

interface TextProperties {
    italic?: boolean;
    bold?: boolean;
    colour?: string;
    title?: string;
    offset?: Vec;
    commentIndicator?: boolean;
}

// See https://vanseodesign.com/web-design/svg-text-baseline-alignment/ for excellent discussion
// on SVG text aligment properties.
const Code = styled.text`
    font-size: ${THEME.fontSizePx}px;
    font-family: ${THEME.fontFamily};
    dominant-baseline: text-before-edge;
`;

const CommentIndicator = styled.tspan`
    baseline-shift: super;
    fill: ${THEME.commentColour};
    font-size: ${THEME.fontSizePx * 0.6}px;
    font-weight: normal;
`;

function CreateCircle({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
    const r = THEME.createCircle.radius;
    const maxR = THEME.createCircle.maxRadius;
    const cx = r;
    const cy = THEME.fontSizePx / 2 + 3;
    const rect = new Rect(new Vec(cx - maxR, cy - maxR), new Size(maxR * 2));
    return (
        <HoverHitBox area={rect} onClick={onClick} title="Add an argument...">
            {mouseOver => (
                <motion.circle
                    fill="none"
                    stroke={THEME.decorationColour}
                    strokeWidth={1}
                    animate={{ r: mouseOver ? maxR : r }}
                    r={r}
                    cx={cx}
                    cy={cy}
                    transition={{ duration: 0.1 }}
                />
            )}
        </HoverHitBox>
    );
}

// This lets all inline child areas have the same height, preventing
// the selection and highlight rects from overlapping with the lines.
// This is a limitation of the layout engine, we do not yet know how
// many underlines an expr will have until higher up in call stack,
// so we just set the height here, now that we know for sure.
function setAreasHeightInPlace(areas: Area[], height: number) {
    for (const area of areas) {
        if (!area.inline) continue;
        area.rect = area.rect.withSize(new Size(area.rect.size.width, height));
        setAreasHeightInPlace(area.children, height);
    }
}

export function materialiseUnderlines(theme: ThemeType, parent: Layout) {
    const layout = parent.withNoUnderlines();
    const gap = theme.underlineSpacingPx;
    parent.underlines.forEach((x, i) => {
        const pos = new Vec(x.offset, parent.size.height + x.level * gap);
        layout.nodes.push(<UnderlineLine start={pos} end={pos.dx(x.length)} key={"U" + i} />);
    });
    const height = max(parent.underlines.map(x => x.level)) * gap;
    layout.size = layout.size.pad(new Vec(0, height));
    setAreasHeightInPlace(layout.areas, layout.size.height);
    return layout;
}

export interface ExprDelegate {
    isFrozen?(expr: Expr): boolean;
    selection?: Optional<ExprId>; // Only checked by blanks.
    focused?: boolean;
    foldComments?: boolean;
    onHoverExpr?(e: React.MouseEvent, expr: Optional<Expr>): void;
    onClickExpr?(e: React.MouseEvent, expr: Expr): void;
    onClickCreateCircle?(e: React.MouseEvent, expr: Expr): void;
    onMouseDown?(e: React.MouseEvent, expr: Expr): void;
}

interface ExprLayoutProps {
    hasDisabledParent: boolean;
}

export class ExprLayout implements ExprVisitor<Layout> {
    constructor(
        private readonly t: ThemeType,
        private readonly delegate: Optional<ExprDelegate>,
        private readonly props: ExprLayoutProps = { hasDisabledParent: false },
    ) {}

    private exprProps(expr: Expr) {
        return {
            onMouseEnter: (e: React.MouseEvent) => this.delegate?.onHoverExpr?.(e, expr),
            onMouseLeave: (e: React.MouseEvent) => this.delegate?.onHoverExpr?.(e, null),
            onClick: (e: React.MouseEvent) => this.delegate?.onClickExpr?.(e, expr),
            onMouseDown: (e: React.MouseEvent) => this.delegate?.onMouseDown?.(e, expr),
        };
    }

    private layoutText(
        expr: Expr,
        text: string,
        { italic, colour, title, bold, offset, commentIndicator }: TextProperties = {},
    ) {
        const disabled = expr.data.disabled || this.props.hasDisabledParent;
        const layout = new Layout(
            (
                <Code
                    fill={disabled ? this.t.disabledExprColour : colour}
                    fontStyle={italic ? "italic" : undefined}
                    fontWeight={bold ? "bold" : undefined}
                    x={offset?.x}
                    y={offset?.y}
                    {...this.exprProps(expr)}
                    key={0}
                >
                    {title && <title>{title}</title>}
                    {text}
                    {commentIndicator && <CommentIndicator>?</CommentIndicator>}
                </Code>
            ),
            TextMetrics.global.measure(text, { italic, bold }),
        );
        layout.inline = true;
        return layout;
    }

    private layoutCreateCircle(expr: Expr) {
        if (this.delegate?.isFrozen?.(expr)) return;
        return new Layout(
            (<CreateCircle onClick={e => this.delegate?.onClickCreateCircle?.(e, expr)} key={0} />),
            new Size(this.t.createCircle.maxRadius, this.t.fontSizePx),
        );
    }

    private layoutComment(expr: Expr) {
        if (expr.data.comment == null || this.delegate?.foldComments) return null;
        return this.layoutText(expr, expr.data.comment, {
            italic: true,
            colour: this.t.commentColour,
        });
    }

    layout(expr: Expr): Layout {
        const layout = expr.visit(this);
        // This associates the layout with the expr, which is used for generating selection areas.
        layout.expr = expr;
        return layout;
    }

    private layoutInner(parent: Expr, expr: Expr) {
        return new ExprLayout(this.t, this.delegate, {
            hasDisabledParent: this.props.hasDisabledParent || parent.data.disabled,
        }).layout(expr);
    }

    visitList(expr: E.List): Layout {
        const layout = vstack(
            this.t.lineSpacingPx,
            expr.list.map(x => materialiseUnderlines(this.t, this.layoutInner(expr, x))),
        );
        const line = new Rect(new Vec(3, 5), new Size(0, layout.size.height - 5));
        // Only thing outside layoutText checking this.
        const disabled = expr.data.disabled || this.props.hasDisabledParent;
        const ruler = (
            <HitBox area={line.pad(new Vec(5))} {...this.exprProps(expr)} key={0}>
                <SvgLine
                    start={line.origin}
                    end={line.bottom_right}
                    stroke={disabled ? this.t.disabledExprColour : this.t.listRulerStroke}
                />
            </HitBox>
        );
        return vstack(
            this.t.lineSpacingPx,
            this.layoutComment(expr),
            hstack(0, new Layout(ruler, new Size(10, 0)), layout),
        );
    }

    visitLiteral(expr: E.Literal): Layout {
        let content = expr.content;
        if (expr.type == "str") content = `"${expr.content}"`;
        else if (expr.type == "symbol") content = expr.content + ":";
        else if (expr.type == "int") {
            content = new Intl.NumberFormat().format(parseFloat(expr.content));
        }

        return this.layoutText(expr, content, {
            title: expr.data.comment,
            colour: this.t.literalColour,
            italic: expr.type === "symbol",
            commentIndicator: expr.data.comment != null,
        });
    }

    visitVariable(expr: E.Variable): Layout {
        return this.layoutText(expr, expr.name, {
            title: expr.data.comment,
            commentIndicator: expr.data.comment != null,
            colour: this.t.variableColour,
        });
    }

    visitBlank(expr: E.Blank): Layout {
        const padding = this.t.blanks.padding;
        const text = this.layoutText(expr, expr.data.comment ?? "?", {
            colour: this.t.blanks.textColour,
            offset: padding,
        });
        let rect = new Rect(padding, text.size).pad(padding);
        if (rect.width < rect.height) {
            rect = rect.withSize(new Size(rect.height)); // Make the pill square.
        }
        const { x, y, width, height } = rect;
        const selected = this.delegate?.selection === expr.id;
        const pill = (mouseOver: boolean) => (
            <motion.rect
                {...{ width, height, x, y }}
                animate={{
                    // Here we recreate the selection rect colouring logic.
                    //TODO: Find a more modular way.
                    fill: selected
                        ? this.delegate?.focused
                            ? this.t.selection.fill
                            : this.t.selection.blurredFill
                        : mouseOver && !this.delegate?.isFrozen?.(expr)
                        ? this.t.blanks.fillHover
                        : this.t.blanks.fill,
                }}
                initial={false}
                rx={rect.height / 2}
                strokeWidth={1}
                stroke={
                    selected
                        ? this.delegate?.focused
                            ? this.t.selection.stroke
                            : this.t.selection.blurredStroke
                        : this.t.blanks.stroke
                }
            />
        );
        const layout = new Layout(
            (
                <HoverHitBox area={rect} {...this.exprProps(expr)} key={0}>
                    {mouseOver => (
                        <>
                            {pill(mouseOver)}
                            {text.nodes}
                        </>
                    )}
                </HoverHitBox>
            ),
            rect.size,
        );
        layout.inline = true;
        return layout;
    }

    visitCall(expr: E.Call): Layout {
        const args = expr.args.map(x => this.layoutInner(expr, x), this);
        const inline = isCallInline(this.t, args);
        const fnName = hstack(
            this.t.createCircle.maxRadius,
            this.layoutText(expr, expr.fn, {
                bold: !inline,
                commentIndicator: expr.data.comment != null && this.delegate?.foldComments,
                colour: this.t.callColour,
            }),
            this.layoutCreateCircle(expr),
        );

        let layout: Layout;
        // Adding a comment makes a call non-inline but not bold.
        if (inline && expr.data.comment == null) {
            const inlineMarginPx = TextMetrics.global.measure("\xa0").width; // Non-breaking space.
            layout = hstack(inlineMarginPx, fnName, args);
            layout.isUnderlined = true;
            layout.inline = true;
        } else {
            layout = hstack(
                this.t.lineSpacingPx,
                fnName,
                vstack(
                    this.t.lineSpacingPx,
                    args.map(x => materialiseUnderlines(this.t, x)),
                ),
            );
        }

        const comment = this.layoutComment(expr);
        return vstack(this.t.lineSpacingPx, comment, layout);
    }
}

function isCallInline(theme: ThemeType, args: readonly Layout[]): boolean {
    if (args.length === 0) {
        return true;
    }
    if (!args.every(x => x.inline)) {
        return false;
    }
    // Our situation won't improve much from here on by making the function not-inline.
    if (args.length === 1) {
        return true;
    }
    // Do we need a line break?
    const lineWidth = args.map(x => x.size.width).reduce((x, y) => x + y, 0);
    if (lineWidth > theme.lineBreakPointPx && args.length > 0) {
        return false;
    }
    // Is the expression too nested?
    const underlinesHeight = max(args.map(x => x.underlinesHeight()));
    const MAX_NESTING_LEVEL = 3;
    return underlinesHeight < MAX_NESTING_LEVEL;
}
