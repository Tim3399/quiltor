import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { IconButton } from "../../design";
import { useI18n } from "../../i18n";

export interface SearchNavigationProps {
  query: string;
  current: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function SearchNavigation({
  query,
  current,
  total,
  onPrevious,
  onNext,
  onClose,
}: SearchNavigationProps) {
  const { t } = useI18n();

  return (
    <search className="text-search-navigation" aria-label={t("textSearchResults")}>
      <Search aria-hidden="true" />
      <strong title={query}>{query}</strong>
      <span role="status" aria-live="polite">
        {t("searchResultPosition", { current, total })}
      </span>
      <IconButton
        className="text-search-navigation__action"
        label={t("previousSearchResult")}
        icon={<ChevronLeft />}
        disabled={!total}
        onClick={onPrevious}
        title={t("previousSearchResult")}
      />
      <IconButton
        className="text-search-navigation__action"
        label={t("nextSearchResult")}
        icon={<ChevronRight />}
        disabled={!total}
        onClick={onNext}
        title={t("nextSearchResult")}
      />
      <IconButton
        className="text-search-navigation__action"
        label={t("closeTextSearch")}
        icon={<X />}
        onClick={onClose}
        title={t("closeTextSearch")}
      />
    </search>
  );
}
