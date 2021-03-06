import React, { ReactNode } from "react";

import { Offset, Rect, Size } from "geometry";
import { useTheme } from "styled-components";

// A type for components that have custom props but pass everything else on.
type CustomSvgProps<Element, CustomProps> = CustomProps &
    Omit<React.SVGProps<Element>, keyof CustomProps>;

// Naming convention: generic svg components have the prefix Svg, bot established UI elements.
export function SvgGroup({
    translate = Offset.zero,
    children,
    ...props
}: CustomSvgProps<SVGGElement, { translate?: Offset }>) {
    return (
        <g
            {...props}
            transform={
                translate.isZero()
                    ? undefined
                    : `translate(${Math.round(translate.x)} ${Math.round(translate.y)})`
            }
        >
            {children}
        </g>
    );
}

type LineProps = CustomSvgProps<SVGLineElement, { start: Offset; end: Offset }>;
export function SvgLine({ start, end, stroke, ...props }: LineProps) {
    return <line x1={start.x} x2={end.x} y1={start.y} y2={end.y} stroke={stroke} {...props} />;
}

export function SvgRect({
    rect: { x, y, width, height },
    children,
    ...props
}: CustomSvgProps<SVGRectElement, { rect: Rect }>) {
    return (
        <rect {...{ x, y, width, height }} {...props}>
            {children}
        </rect>
    );
}

export function UnderlineLine(props: Omit<LineProps, "shapeRendering" | "stroke" | "strokeWidth">) {
    // It took a while, but black, crispEdge, 0.5 stroke lines work well. They looks equally well
    // at full and half-pixel multiples; and look good on high-dpi screens.
    const theme = useTheme();
    return (
        <SvgLine
            strokeWidth={0.5}
            shapeRendering="crsipEdges"
            stroke={theme.syntaxColour.underline}
            {...props}
        />
    );
}

interface HitBoxProps<C> extends React.DOMAttributes<SVGRectElement> {
    children: C;
    title?: string;
    area: Rect;
}

export function HitBox({ children, area, title, ...rest }: HitBoxProps<ReactNode>) {
    return (
        <>
            {children}
            <SvgRect rect={area} fill="transparent" strokeWidth="0" {...rest}>
                {title && <title>{title}</title>}
            </SvgRect>
        </>
    );
}

export function DebugRect({ origin, colour = "limegreen" }: { origin?: Offset; colour?: string }) {
    return (
        <SvgRect
            rect={new Rect(origin ?? new Offset(0), new Size(5))}
            fill={colour}
            stroke="none"
            opacity="0.7"
        />
    );
}
