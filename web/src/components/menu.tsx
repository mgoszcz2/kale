import React, { ReactNode, Ref } from "react";
import styled from "styled-components";

import { Optional } from "utils";
import { useDisableScrolling } from "hooks";

const Container = styled.div`
    background: ${(p) => p.theme.colour.popupBackground};
    border-radius: ${(p) => p.theme.general.borderRadius}px;
    box-shadow: ${(p) => p.theme.shadow.normal};
    z-index: 1000;
    position: fixed;
`;

// Clips the highlight boxes, since Container needs to have overflow to potentially show the popover
// arrow.
const ContainerClip = styled.div`
    border-radius: ${(p) => p.theme.general.borderRadius}px;
    overflow: hidden;
`;

const triangleSize = 12;

// See https://css-tricks.com/triangle-with-shadow/. We create a 45deg rotated square, then shift it
// up and use overflow: hidden to chop the bottom bit off.
const Arrow = styled.div`
    position: absolute;
    overflow: hidden;
    height: ${triangleSize}px;
    width: ${triangleSize * 2}px;
    left: 50%;
    transform: translateX(-50%);
    top: -${triangleSize}px;

    &::before {
        background: ${(p) => p.theme.colour.popupBackground};
        left: ${triangleSize / 2}px;
        top: ${triangleSize / 2}px;
        box-shadow: ${(p) => p.theme.shadow.small};
        position: absolute;
        transform: rotate(45deg);
        content: "";
        width: ${triangleSize}px;
        height: ${triangleSize}px;
    }
`;

interface MenuItemContainerProps {
    selected: boolean;
    disabled: boolean;
    minimalPadding: boolean;
}

const MenuItemContainer = styled.div<MenuItemContainerProps>`
    background: ${(p) =>
        !p.disabled && p.selected ? p.theme.colour.brightClickable : "transparent"};
    display: flex;
    align-items: center;
    & > svg {
        margin-right: 5px;
    }
    color: ${(p) =>
        p.disabled ? p.theme.colour.disabled : p.selected ? "white" : p.theme.colour.mainText};
    overflow: hidden;
    padding: ${(p) => (p.minimalPadding ? "0" : "7px 10px")};
    @media (any-pointer: coarse) {
        padding: ${(p) => (p.minimalPadding ? "0" : "14px 10px")};
    }
`;

// Convenience class for overflowing text.
export const MenuTextWrapper = styled.div`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`;

export interface MenuItem {
    id: string;
    disabled?: boolean;
}

export interface MenuProps<I> {
    items: readonly I[];
    width?: number;
    noPadding?: boolean;
    popover?: boolean;
    selected: Optional<number>;
    containerRef?: Ref<HTMLDivElement>;
    onSetSelected(index: number | null): void;
    onClick(item: I): void;
    // Function-children to render a menu item in a flexbox context.
    children(item: I): ReactNode;
    // Special function for the context menu.
    minimalPadding?(index: number): boolean;
}

export default function Menu<I extends MenuItem>(props: MenuProps<I>) {
    useDisableScrolling();
    return (
        // Shift the position: fixed container by popover triangle's size.
        <div style={{ position: "relative", top: props.popover ? triangleSize : 0 }}>
            <Container
                style={{
                    width: props.width ?? "max-content",
                    transform: props.popover ? "translateX(-50%)" : undefined,
                    padding: props.noPadding ? undefined : "padding: 6px 0",
                }}
                ref={props.containerRef}
            >
                {props.popover && <Arrow />}
                <ContainerClip>
                    {props.items.map((item, i) => {
                        const minimalPadding = props.minimalPadding?.(i) ?? false;
                        return (
                            <MenuItemContainer
                                key={item.id}
                                onMouseDown={(e) => e.preventDefault()} // Don't blur.
                                onClick={() => props.onClick(item)}
                                onContextMenu={(e) => e.preventDefault()} // Can't right click.
                                onMouseMove={() => props.onSetSelected(i)}
                                onMouseLeave={() => props.onSetSelected(null)}
                                // Styling.
                                disabled={item.disabled ?? false}
                                selected={i === props.selected}
                                minimalPadding={minimalPadding}
                            >
                                {props.children(item)}
                            </MenuItemContainer>
                        );
                    })}
                </ContainerClip>
            </Container>
        </div>
    );
}
