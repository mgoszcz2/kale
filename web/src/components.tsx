import styled, { css } from "styled-components";
import {
    SpaceProps,
    GridProps,
    FlexboxProps,
    LayoutProps,
    BorderProps,
    PositionProps,
    grid,
    space,
    layout,
    flexbox,
    border,
    position,
} from "styled-system";

export type BoxProps = SpaceProps &
    GridProps &
    FlexboxProps &
    LayoutProps &
    BorderProps &
    PositionProps;
export const Box = styled.div<BoxProps>`
    ${space}
    ${grid}
    ${flexbox}
    ${layout}
    ${border}
    ${position}
`;

export interface StackProps extends BoxProps {
    gap?: number;
    vertical?: boolean;
}

const getSide = (p: StackProps) => "margin-" + (p.vertical ? "bottom" : "right");
export const Stack = styled(Box)`
    display: flex;
    flex-direction: ${(p: StackProps) => (p.vertical ? "column" : "row")};
    & > *:last-child {
        ${getSide}: 0;
    }
    & > * {
        ${getSide}: ${(p: StackProps) => p.gap ?? 0}px;
    }
`;

interface ShortcutProps {
    subtle?: boolean;
}

export const Shortcut = styled.kbd<ShortcutProps>`
    display: inline-block;
    background-color: ${(p) => (p.subtle ? p.theme.colour.innerBackground : p.theme.colour.grey)};
    border-radius: 3px;
    border: 1px solid ${(p) => p.theme.colour.subtleClickable};
    box-shadow: 0 1px 1px ${(p) => p.theme.colour.subtleText};
    font-size: 0.85em;
    padding: 2px;
    white-space: nowrap;
    font-variant-numeric: normal;
    min-width: 1.5em;
    text-align: center;
    font-family: inherit;
    /* Ensure we always look snazzy no matter the context */
    color: ${(p) => p.theme.colour.mainText};
    line-height: 1;
    & + & {
        margin-left: 1ex;
    }
`;

// Prevent a shortcut group from containing line-breaks.
export const ShortcutGroup = styled.span`
    display: inline-block;
`;

export const SubtleButton = styled.button<{ selected?: boolean }>`
    color: ${(p) => p.theme.colour.clickable};
    transition: color 0.1s;
    ${(p) => p.selected && "-webkit-text-stroke: 1px currentcolor"};
    &:hover {
        color: ${(p) => (p.selected ? undefined : p.theme.colour.active)};
    }
    &:disabled {
        color: ${(p) => p.theme.colour.disabled};
    }
`;

// Meant for wrapping react-icons icons.
export const IconButton = styled.button`
    background: none;
    border: none;
    color: ${(p) => p.theme.colour.clickable};
    & > svg {
        width: 2em;
        height: 2em;
    }
    &:hover,
    &:focus {
        color: ${(p) => p.theme.colour.active};
    }
    &:disabled {
        color: ${(p) => p.theme.colour.disabled};
    }
`;

export const NonIdealText = styled.p`
    text-align: center;
    color: ${(p) => p.theme.colour.subtleText};
`;

export const PaneHeading = styled.h2`
    font-weight: 700;
    font-size: 20px;
    font-variant-numeric: oldstyle-nums;
`;
