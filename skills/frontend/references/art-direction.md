# Art direction

A look is art-directed once and reused everywhere after. Design it from a **concept**, build it from **drawn assets**, and prove it in a **lineup** against shipped work. Recolouring and refonting the components that already exist is a **theme swap**: it keeps the default layout, the default boxes, and the default sameness, and people read the result as generated.

## Steps

1. **References.** Find at least five shipped interfaces in the same medium that set the bar the owner named or would recognise. Look at their screenshots, not your memory of them. For each, write the devices it uses: type, shapes, materials, density, hierarchy, motion. Done when every device on your list is tied to a screenshot you looked at.
2. **Concept.** State in one sentence what the interface *is* in the product's world: an object, a place, a document, a machine. Then list every element on every screen with the thing it is under that concept. Done when each element has an answer; an element without one is drawn as the plainest thing the concept contains.
3. **System.** Fix the values before any screen exists:
   - Type: one workhorse family for everything that is read, at most one display face for titles. Set the real strings and the longest real numbers at device size, and check each digit against its neighbours.
   - One spacing scale, one shape language (corners, strokes), one way to show depth.
   - Colour by role. Each accent belongs to one meaning.
   - One icon set, drawn at one weight.
   - One motion curve and a short list of durations.
4. **Assets.** Draw the concept's objects as assets: vector shapes, textures, nine-slices, illustration. A panel is an asset with its own edge, material and wear, built once and reused.
5. **Composition.** Give each screen one hero and make it several times the size of the quietest text. Group by proximity and alignment; give a frame only to what the concept frames. Take density from the references.
6. **Lineup.** Render each screen at device size and place it between the references. Name what marks yours as the weakest in the row, fix that, and repeat. Done when you can name nothing, and when the screen would still be recognisable as this product with its name removed.
7. **Show the lineup.** Send the owner your screens beside the references, with the concept sentence. The comparison is the proof.

## Tells

Check each screen against these in step 6. Each is a mark of a theme swap:

- Every element sits in its own bordered box.
- A novelty display face carries body text, labels or numerals.
- Everything is centred, evenly spaced and about the same size.
- The palette is a dark neutral with one gold or neon accent, and gradients and glows serve as decoration.
- Ornament that belongs to no object in the concept.
- Icons from more than one set or weight.
- Text that is cramped, clipped or scaled to fit its box.
- A new screen that is an old screen recoloured.

## Placeholders

Interim UI is labelled **placeholder** on the artifact itself and in the message that carries it, with what it stands in for. Unlabelled, it is judged as the design.
