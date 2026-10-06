import type { RefObject } from "react";
import type { MapFeatureLink } from "./types";

export type LiveMapSelection = { featureKey: string; links: MapFeatureLink[] } | null;

export function FullSurveyMap({
  mapRef,
  isLiveData,
  featureCount,
  selection,
  onLoad,
  onZoomIn,
  onZoomOut,
  onReset,
  onOpenParcel,
  onGoRegistry
}: {
  mapRef: RefObject<HTMLObjectElement | null>;
  isLiveData: boolean;
  featureCount: number;
  selection: LiveMapSelection;
  onLoad: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onOpenParcel: (parcelId: string) => void;
  onGoRegistry: () => void;
}) {
  return <div className="map-layout">
    <section className="page-intro map-intro">
      <div><div className="eyebrow">Combined village map</div><h2>Land & consent</h2><p>{isLiveData ? "Select a survey boundary to open its land record. Green means consent received." : "Sign in to see consent colours and open survey records."}</p></div>
      <button className="button button-secondary" onClick={onGoRegistry} type="button">View land register</button>
    </section>
    <section className="map-legend"><span><i className="swatch-green" /> Consent received</span><span><i className="swatch-amber" /> Pending</span><span><i className="swatch-grey" /> Not ready / unconfirmed</span><span><i className="swatch-red" /> Blocked / rejected</span></section>
    <section className="card map-card">
      <div className="map-canvas">
        <object aria-label="Full interactive combined village survey map" className="survey-map" data="./maps/combined-villages-full.svg" onLoad={onLoad} ref={mapRef} type="image/svg+xml"><p>Your browser could not render the survey SVG.</p></object>
        <div className="map-controls" aria-label="Map zoom controls"><button aria-label="Zoom in" onClick={onZoomIn} type="button">+</button><button aria-label="Zoom out" onClick={onZoomOut} type="button">−</button><button aria-label="Fit all villages" className="map-reset" onClick={onReset} type="button">Fit map</button></div>
      </div>
    </section>
    <section className="card map-footer">
      <div>
        <strong>{selection ? selection.links.length ? "Selected survey boundary" : "Unmatched survey boundary" : "Three villages. One map."}</strong>
        <p>{selection ? selection.links.length === 1 ? "Opening the survey record." : selection.links.length ? "Choose the correct village and survey below." : "There is no confirmed land-register match for this boundary yet." : "Use + and − to zoom. Fit map returns to the complete village view."}</p>
        {selection && selection.links.length > 1 && <div className="map-link-list">{selection.links.map((link) => <button key={link.parcel_id} className="button button-secondary" onClick={() => onOpenParcel(link.parcel_id)} type="button">{link.village_name} · Survey {link.survey_number}{link.match_confidence !== "high" ? " (review)" : ""}</button>)}</div>}
      </div>
      <span className="map-proof">{featureCount ? `${featureCount} survey boundaries` : "Combined DWG map"}</span>
    </section>
  </div>;
}
