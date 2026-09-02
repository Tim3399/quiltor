import { Image, ImageOff, ImagePlus, Replace } from "lucide-react";
import { Button } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode } from "../model";
import "./PlaceMapSection.css";

/**
 * The picture a place stands on, in the inspector.
 *
 * A map is not a second kind of thing -- it is a picture a place carries, and
 * every place may carry one. So this is where one is chosen, swapped and taken
 * away again, for a place that never had one just as much as for a place that
 * arrived as a map.
 *
 * Taking the picture away leaves the place, and leaves whatever is inside it:
 * the level under a map is the grid it always was, and works without a picture.
 * That is the whole point of the picture being optional.
 */
export function PlaceMapSection({
  place,
  source,
  onChoose,
  onRemove,
}: {
  place: FigureNode;
  /** Where the stored picture can be read from, when there is one. */
  source: string | null;
  onChoose: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="place-map-section" aria-label={t("placeMapSection")}>
      <h2 className="place-map-section__title">{t("placeMapSection")}</h2>
      {source ? (
        <>
          <img className="place-map-section__preview" src={source} alt={place.name} />
          <div className="place-map-section__actions">
            <Button size="compact" icon={<Replace />} onClick={onChoose}>
              {t("placeReplaceImage")}
            </Button>
            <Button size="compact" appearance="ghost" icon={<ImageOff />} onClick={onRemove}>
              {t("placeRemoveImage")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="place-map-section__hint">
            <Image aria-hidden="true" />
            {t("placeNoImageBody")}
          </p>
          <div className="place-map-section__actions">
            <Button size="compact" icon={<ImagePlus />} onClick={onChoose}>
              {t("placeChooseImage")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
