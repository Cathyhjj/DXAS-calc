import { IconBook2, IconInfoCircle, IconX } from "@tabler/icons-react";

export function AboutDialog({ onClose, closeButtonRef, dialogRef }) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="about-dialog dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        aria-describedby="about-dialog-description"
        tabIndex={-1}
      >
        <div className="about-dialog__header dialog-header">
          <div className="about-dialog__mark" aria-hidden="true">
            <IconBook2 size={21} stroke={1.8} />
          </div>
          <div>
            <p className="eyebrow">About this model</p>
            <h2 id="about-dialog-title">DXASCalc</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button icon-action"
            type="button"
            onClick={onClose}
            aria-label="Close About dialog"
          >
            <IconX aria-hidden="true" size={19} />
          </button>
        </div>
        <div className="about-dialog__body dialog-body" id="about-dialog-description">
          <p>
            DXASCalc explores dispersive X-ray absorption geometry for bent-crystal Bragg and
            Laue setups. The calculation reports geometry, energy span, beam size, and detector
            sampling together with an intrinsic crystal response from the validated JSON API.
          </p>
          <div className="about-dialog__notice">
            <IconInfoCircle aria-hidden="true" size={18} stroke={1.8} />
            <p>
              Detector sampling is an energy interval per pixel, not a FWHM. The estimated total
              resolution combines the pixel interval with finite-source and intrinsic-crystal
              terms; review the reported model assumptions before treating it as an experimental
              limit.
            </p>
          </div>
          <p>
            Widths and spans are shown as magnitudes. Signed values remain part of the result for
            orientation, and a negative bending radius is a valid curvature convention.
          </p>
        </div>
        <div className="about-dialog__footer dialog-footer">
          <button className="button button--primary dialog-action" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
