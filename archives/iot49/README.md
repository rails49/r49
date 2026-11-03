# Ceiling captures

Three 48 MP captures of an N-scale layout from a camera on the ceiling, taken
to train the detector at the highest DPT available.

| Archive | Id | Images | Labels | DPT | Residual |
| :--- | :--- | ---: | ---: | ---: | ---: |
| `ceiling-2026-10-28.r49` | `0Rc97ho9K88` | 12 | 268 | 32.6 | 236 px |
| `ceiling-2026-10-29.r49` | `0RdWS5uEHYG` | 12 | 404 | 32.6 | 165 px |
| `ceiling-2026-10-29b.r49` | `0Re28B7eddY` | 11 | 385 | 32.4 | 155 px |

All labels are `human`. Every image is labeled complete except `IMG_2908.jpg`
in `ceiling-2026-10-29b`.

Each capture had more images than its archive holds. Some were removed to
keep each archive under GitHub's 100 MiB file limit. The ProRAW originals
(`.DNG`) are not in this repository.

## Capture

- iPhone 16 Pro Max on the ceiling, 1x main camera (24 mm equivalent), ProRAW
  48 MP, 8064 × 6048. Shutter from Apple Watch Camera Remote.
- Camera about 1500 mm above the layout. The layout is about 2000 × 1000 mm.
- Transferred by AirDrop with All Photos Data on.
- Shots taken with another lens or resolution in the same sessions are left
  out: the 0.5x ultra-wide (5504 × 4128), the 26 mm crop (7444 × 5582) and
  12 MP (4032 × 3024).

| Archive | Conditions |
| :--- | :--- |
| `ceiling-2026-10-28` | First capture. |
| `ceiling-2026-10-29` | Sunlight and shadows, cars in new places. |
| `ceiling-2026-10-29b` | 12:12–17:12, mostly the same scenes under changing light. IMG_2933 was removed after labeling because the camera had shifted. |

## Conversion

1. `sips -s format tiff IMG_x.DNG`, with Core Image RAW defaults.
2. Pillow: apply the EXIF orientation, rotate 90° clockwise, and save as JPEG
   quality 95 with the ICC profile and no orientation tag.

Every image is 8064 × 6048 landscape with no orientation tag, so browsers and
Pillow see the same pixels.

## Calibration

Each archive is calibrated on its own, with four points on the board edges,
2000 × 1000 mm apart. The two points at y 1000 are at z 80 (measured), the
two at y 0 are at z 0.

The residuals are large because the raised points do not appear as much larger
as z 80 predicts. A camera tilt of about 5° would explain it. For
`ceiling-2026-10-28`, a fit with all points at z 0 gives DPT 33.5 with a
residual of 36 px. Treat DPT as good to about 3%.
