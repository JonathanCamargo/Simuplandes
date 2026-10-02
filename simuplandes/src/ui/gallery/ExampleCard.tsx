/**
 * One gallery card: a static `DrawingSvg` thumbnail of the example (memoized
 * per example id), its localized title and a one-line description. The whole
 * card is a button, so it is keyboard focusable.
 */

import { memo, useMemo, type ReactNode } from "react";
import { Box, Card, CardActionArea, Typography, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";
import { DrawingSvg } from "../export/DrawingSvg";
import { loadExampleDocument, type ExampleEntry } from "../../examples/registry";
import { fitViewToDocument } from "./fitView";

const THUMB_WIDTH = 168;
const THUMB_HEIGHT = 104;
const THUMB_PADDING = 22;

export interface ExampleCardProps {
  example: ExampleEntry;
  onSelect: (id: ExampleEntry["id"]) => void;
}

function ExampleCardImpl({ example, onSelect }: ExampleCardProps): ReactNode {
  const { t } = useTranslation();
  const theme = useTheme();
  const themeMode = theme.palette.mode === "dark" ? "dark" : "light";
  const thumbnail = useMemo(() => {
    const doc = loadExampleDocument(example.id);
    return { doc, view: fitViewToDocument(doc, THUMB_WIDTH, THUMB_HEIGHT, THUMB_PADDING) };
  }, [example.id]);

  return (
    <Card variant="outlined" sx={{ width: THUMB_WIDTH + 2 }}>
      <CardActionArea
        data-testid="example-card"
        data-example-id={example.id}
        onClick={() => onSelect(example.id)}
        sx={{ display: "block" }}
      >
        <Box sx={{ lineHeight: 0, bgcolor: "background.default" }} aria-hidden>
          <DrawingSvg doc={thumbnail.doc} view={thumbnail.view} themeMode={themeMode} />
        </Box>
        <Box sx={{ px: 1, py: 0.75 }}>
          <Typography variant="subtitle2" component="div" noWrap>
            {t(example.titleKey)}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            {t(example.descriptionKey)}
          </Typography>
        </Box>
      </CardActionArea>
    </Card>
  );
}

export const ExampleCard = memo(ExampleCardImpl);
