import * as ReactDOM from "react-dom";
import React, { Component, Fragment } from "react";
import styled, { StyleSheetManager, createGlobalStyle, css } from "styled-components";
import { motion } from "framer-motion";

import * as E from "./expr";
import { Expr } from "./expr";
import ExprView, { DragAndDropSurface } from "./expr_view";
import TextMetrics from "./text_metrics";
import THEME from "./theme";
import { Box, HorizonstalStack, Shortcut, SubtleButton } from "./components";
import Editor from "./editor";

const GlobalStyle = createGlobalStyle`
#main {
    position: absolute;
    top: 0;
    height: 100%;
    width: 100%;
}
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}
body {
    font: 14px/1 "Nunito", sans-serif;
    color: #404040;
}
p {
    line-height: 1.8;
    font-variant-numeric: oldstyle-nums;
}
/* Nothing inside svgs should be selectable */
svg * {
    user-select: none;
    cursor: default;
}
h1, h2, h3 {
    user-select: none;
}
h1 {
    font-weight: 900;
    font-size: 25px;
}
h2, h3 {
    font-weight: 700;
    font-size: 20px;
}
`;

interface ShortcutExpr {
    expr: Expr;
    shortcut?: string;
}

interface ExprViewListProps {
    animate?: boolean;
    exprs: ShortcutExpr[];
    frozen?: boolean;
    fallback?: string;
}

const ExprListItem = styled(motion.div)`
    grid-column: expr;
    justify-self: left;
    border: 1px solid #dfe1e5;
    border-radius: ${THEME.exprViewPaddingPx}px;
`;

const ExprListShortcut = styled(Shortcut)`
    grid-column: shortcut;
    justify-self: right;
    margin-top: ${THEME.exprViewPaddingPx / 2}px;
`;

const ExprList = styled.div`
    display: grid;
    grid-template-columns:
        [shortcut] auto
        [expr] min-content;
    gap: 10px;
    grid-auto-rows: min-content;
    align-items: start;
    margin: 20px 0 40px;
`;

function ExprViewList({ exprs, frozen, animate, fallback }: ExprViewListProps) {
    const renderItem = (expr: Expr, shortcut?: string) => (
        // This has to be a fragment. Otherwise the items won't layout in a grid.
        <Fragment key={expr.id}>
            {shortcut && THEME.showingShortcuts && <ExprListShortcut>{shortcut}</ExprListShortcut>}
            <ExprListItem
                initial={animate && { opacity: 0.8, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.1, ease: "easeIn" }}
            >
                <ExprView expr={expr} frozen={frozen} />
            </ExprListItem>
        </Fragment>
    );
    return (
        <ExprList>
            {exprs.length === 0 && <p>{fallback}</p>}
            {exprs.map(x => renderItem(x.expr, x.shortcut))}
        </ExprList>
    );
}

const toyBoxExprs = [
    { shortcut: "S", expr: new E.List([blank("first line"), blank("second line")]) },
    { shortcut: "F", expr: new E.Call("if", [blank("true branch"), blank("false branch")]) },
    { shortcut: "A", expr: new E.Variable("variable") },
    { expr: new E.Literal("a string", "str") },
    { expr: new E.Literal("42", "int") },
];
function ToyBox() {
    return (
        <Box gridArea="toybox" overflow="auto">
            <h2>Blocks</h2>
            <ExprViewList frozen exprs={toyBoxExprs} />
        </Box>
    );
}

function YankList({ exprs, onClearAll }: { exprs: Expr[]; onClearAll: () => void }) {
    //TODO: Make these editors inside of ExprViews (and make it not frozen).
    const yankList = exprs.map((x, i) => ({
        shortcut: i < 10 ? i.toString() : undefined,
        expr: x,
    }));
    return (
        <Box gridArea="yanklist" overflow="auto">
            <HorizonstalStack gap={10} alignItems="baseline">
                <h2>Clipboard History</h2>
                <SubtleButton onClick={onClearAll} disabled={yankList.length === 0}>
                    Clear All
                </SubtleButton>
            </HorizonstalStack>
            <ExprViewList frozen animate exprs={yankList} fallback="Nothing here yet." />
        </Box>
    );
}

interface KaleState {
    yankList: Expr[];
}

function blank(comment: string) {
    return new E.Blank(E.exprData(comment));
}

class Kale extends Component<{}, KaleState> {
    private static readonly Container = styled.div`
        display: grid;
        grid-template-areas:
            "nav nav nav"
            "toybox editor yanklist";
        grid-template-rows: min-content auto;
        grid-template-columns: max-content minmax(min-content, auto) max-content;
        gap: 20px 40px;
        padding: 15px 20px 0;
        height: 100%;
    `;

    private static readonly Heading = styled.h1`
        color: #0ba902;
        letter-spacing: 2px;
    `;

    private static readonly Help = styled.p`
        max-width: 600px;
    `;

    state: KaleState = { yankList: [] };

    private readonly addToYankList = (expr: Expr) => {
        if (expr instanceof E.Blank) return;
        this.setState(({ yankList }) => ({
            // Remove duplicate ids.
            yankList: [expr, ...yankList.filter(x => x.id !== expr.id)],
        }));
    };

    private readonly clearYankList = () => {
        this.setState({ yankList: [] });
    };

    private static renderHelp() {
        const S = Shortcut;
        return (
            <Kale.Help>
                Use <S>H</S> <S>J</S> <S>K</S> <S>L</S> to move around. Fill in the blanks with{" "}
                <S>Tab</S>. Use <S>Backspace</S> to Delete and <S>C</S> to Copy. Create blanks with
                the circular buttons or <S>A</S> &mdash; <b>Help is on the way!</b>
            </Kale.Help>
        );
    }

    render() {
        return (
            <React.StrictMode>
                <StyleSheetManager disableVendorPrefixes>
                    <DragAndDropSurface>
                        <GlobalStyle />
                        <Kale.Container>
                            <HorizonstalStack
                                gridArea="nav"
                                gap={10}
                                alignItems="center"
                                paddingBottom={15}
                                borderBottom="1px solid #e4e4e4"
                            >
                                <Kale.Heading>Kale</Kale.Heading>
                                {Kale.renderHelp()}
                            </HorizonstalStack>
                            {THEME.showingToyBox && <ToyBox />}
                            <Editor gridArea="editor" onRemovedExpr={this.addToYankList} />
                            <YankList exprs={this.state.yankList} onClearAll={this.clearYankList} />
                        </Kale.Container>
                    </DragAndDropSurface>
                </StyleSheetManager>
            </React.StrictMode>
        );
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    await TextMetrics.loadGlobal();
    ReactDOM.render(<Kale />, document.getElementById("main"));
});
