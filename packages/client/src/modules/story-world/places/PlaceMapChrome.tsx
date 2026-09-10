import { useLayoutEffect, useRef } from "react";
import { useI18n } from "../../../i18n";
import { GRID_SIZE } from "../figures/relationships";
import type { MapScale } from "../model";
import { PlaceMapActions, type PlaceMapActionsProps } from "./PlaceMapActions";
import { PlaceMapScaleControl } from "./PlaceMapScaleControl";
import { formatScale, mapScaleBar, physicalGridDistance } from "./placeMap";
import type {
  MapChromeLayout as PlaceMapChromeLayout,
  MapChromeSize as PlaceMapChromeSize,
} from "./placeMapChromeModel";
import "./PlaceMapChrome.css";

export type { PlaceMapChromeLayout, PlaceMapChromeSize };

export interface PlaceMapChromeProps extends Omit<PlaceMapActionsProps, "expanded" | "onExpand"> {
  layout: PlaceMapChromeLayout;
  onSize?: (size: PlaceMapChromeSize) => void;
  levelLabel: string;
  placeCount: number;
  gridVisible: boolean;
  zoom: number;
  scale: MapScale | undefined;
  onScale: (patch: Partial<MapScale>) => void;
}

/** Map identity and instruments in screen space; the space between remains the world. */
export function PlaceMapChrome({
  layout,
  onSize,
  levelLabel,
  placeCount,
  gridVisible,
  zoom,
  scale,
  onScale,
  ...actions
}: PlaceMapChromeProps) {
  const { t, locale } = useI18n();
  const header = useRef<HTMLElement>(null);
  const footer = useRef<HTMLElement>(null);
  const density = chromeDensity(layout.width);
  const footerWidth = layout.width;
  const bar = mapScaleBar(scale, zoom);
  const gridDistance = physicalGridDistance(scale, GRID_SIZE);
  const number = new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 });
  const countLabel =
    placeCount === 1 ? t("placeMapOnePlace") : t("placeMapPlaceCount", { n: placeCount });
  const scaleLabel = formatScale(scale, t) || t("placeMapNoScale");
  const gridLabel = !gridVisible
    ? t("placeMapGridOff")
    : gridDistance !== undefined && scale
      ? `${number.format(gridDistance)} ${scale.unitLabel}`
      : t("placeMapGridUnits", { n: GRID_SIZE });

  useLayoutEffect(() => {
    if (!onSize || !header.current || !footer.current) return;
    const report = () => {
      const headerHeight = header.current?.getBoundingClientRect().height ?? 0;
      const footerHeight = footer.current?.getBoundingClientRect().height ?? 0;
      if (headerHeight && footerHeight) onSize({ headerHeight, footerHeight });
    };
    report();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(report);
    observer.observe(header.current);
    observer.observe(footer.current);
    return () => observer.disconnect();
  }, [onSize]);

  return (
    <section
      className="place-map-chrome"
      data-map-id={actions.map.id}
      data-density={density}
      aria-label={t("placeMapChrome", { name: actions.map.name })}
    >
      <div
        className="place-map-chrome__frame"
        style={{
          left: layout.left,
          top: layout.headerTop,
          width: layout.width,
          height: layout.frameHeight,
        }}
        aria-hidden="true"
      />
      <header
        ref={header}
        className="place-map-chrome__header"
        style={{ left: layout.left, top: layout.headerTop, width: layout.width }}
      >
        <div className="place-map-chrome__identity">
          <span className="place-map-chrome__name" title={actions.map.name}>
            {actions.map.name}
          </span>
          <span className="place-map-chrome__context" title={`${levelLabel} · ${countLabel}`}>
            {levelLabel} · {countLabel}
          </span>
        </div>
        <div className="place-map-chrome__actions" role="toolbar" aria-label={t("placeMapActions")}>
          {actions.adjusting ? (
            <span className="place-map-chrome__crop-zoom">
              {Math.round(actions.crop.zoom * 100)} %
            </span>
          ) : null}
          <PlaceMapActions {...actions} expanded />
        </div>
      </header>
      <footer
        ref={footer}
        className="place-map-chrome__footer"
        data-density={chromeDensity(footerWidth)}
        style={{ left: layout.left, top: layout.footerTop, width: footerWidth }}
      >
        <dl className="place-map-chrome__metadata">
          <div className="place-map-chrome__cell place-map-chrome__scale">
            <dt className="place-map-chrome__label">{t("scale")}</dt>
            <dd className="place-map-chrome__value">
              <PlaceMapScaleControl
                key={actions.map.id}
                name={actions.map.name}
                scale={scale}
                onScale={onScale}
                valueLabel={scaleLabel}
                anchorPositionKey={`${actions.map.id}:${layout.left}:${layout.footerTop}:${footerWidth}`}
              />
            </dd>
          </div>
          <div className="place-map-chrome__cell place-map-chrome__grid">
            <dt className="place-map-chrome__label">{t("placeMapGrid")}</dt>
            <dd className="place-map-chrome__value" title={gridLabel}>
              <span className="place-map-chrome__reading">{gridLabel}</span>
            </dd>
          </div>
          <div className="place-map-chrome__cell place-map-chrome__places">
            <dt className="place-map-chrome__label">{t("placeMapPlaces")}</dt>
            <dd className="place-map-chrome__value">
              <span className="place-map-chrome__reading">{number.format(placeCount)}</span>
            </dd>
          </div>
          <div className="place-map-chrome__cell place-map-chrome__level">
            <dt className="place-map-chrome__label">{t("placeMapLevel")}</dt>
            <dd className="place-map-chrome__value" title={levelLabel}>
              <span className="place-map-chrome__reading">{levelLabel}</span>
            </dd>
          </div>
        </dl>
        {bar && scale && footerWidth >= 500 ? (
          <div
            className="place-map-chrome__scale-bar"
            style={{ width: bar.width }}
            role="img"
            aria-label={t("placeMapScaleBar", {
              distance: `${number.format(bar.distance)} ${scale.unitLabel}`,
            })}
          >
            <span className="place-map-chrome__scale-line" style={{ width: bar.width }} />
            <span className="place-map-chrome__scale-distance">
              {number.format(bar.distance)} {scale.unitLabel}
            </span>
          </div>
        ) : null}
      </footer>
    </section>
  );
}

function chromeDensity(width: number) {
  return width < 400 ? "narrow" : width < 620 ? "medium" : "wide";
}
