window.Samples = {
sample: `Title: **THE LAST REEL**
Credit: written by
Author: A. Writer
Source: A sample screenplay for Offbeat
Draft date: First draft
Contact:
    writer@example.com

# Act One

= Two projectionists fight to keep a dying movie palace open for one final night.

INT. THE ORPHEUM - PROJECTION BOOTH - NIGHT [[COLOR BLUE]]

A cramped room that smells of hot dust and vinegar. Two 35mm projectors hum side by side like old dogs asleep on a porch.

MAE OKAFOR (60s, reading glasses on a chain, hands that have threaded ten thousand reels) checks the gate with a flashlight.

MAE
Changeover in ninety seconds.

DESMOND (20s, all elbows, a hoodie that says *USHER*) leans in the doorway with a box of popcorn.

DESMOND
How do you even know that?

MAE
(not looking up)
The cue marks. Little circles, top right corner of the frame. One means get ready. Two means now.

DESMOND
I've watched a thousand movies here and never seen a single circle.

MAE
That's the point, baby. Nobody's supposed to see us.

A tiny white circle FLICKERS on the screen below. Mae's hand drifts to the motor switch.

[[Desmond should notice the second cue himself later — payoff in Act Three.]]

EXT. THE ORPHEUM - MARQUEE - CONTINUOUS [[COLOR ORANGE]]

Half the bulbs are dead. A hand-lettered banner sags under the marquee: **FINAL SHOW SATURDAY**.

A sleek sedan idles at the curb. Inside, a DEVELOPER (40s) photographs the facade with a tablet.

INT. THE ORPHEUM - PROJECTION BOOTH - NIGHT

The changeover. Mae hits the switch — the second projector ROARS to life — and on screen the picture never even blinks.

Desmond applauds, mouth full.

DESMOND
Okay. That was cool.

MAE
Cool is a word for people with somewhere else to be.

DESMOND
I *have* somewhere else to be.

MAE
Then why are you still here?

He doesn't have an answer. She hands him the flashlight.

MAE (CONT'D)
Next one's yours.

# Act Two

INT. THE ORPHEUM - LOBBY - DAY [[COLOR GREEN]]

= The town shows up to fight for the theater.

The lobby is packed. FLYERS, PETITIONS, a folding table with a coffee urn. Desmond stands on a chair with a megaphone that does not work.

DESMOND
Can everybody — hello? Is this —

MAE
It's not on.

DESMOND
It's not on?

MAE
It's never been on. We use it to look official.

OLD MAN TEO
Is the movie still at seven?

CHILD
Is there still candy?

OLD MAN TEO
Is there still candy?

>INTERMISSION<

INT. THE ORPHEUM - AUDITORIUM - NIGHT [[COLOR PURPLE]]

Every seat filled. Mae stands at the back, arms crossed, pretending not to cry.

~We'll meet again, don't know where,
~don't know when...

The final reel begins.

CUT TO:

EXT. THE ORPHEUM - DAWN

The marquee, every bulb now burning.

>THE END<
`,

help: `Title: Fountain Quick Guide
Credit: for
Author: Offbeat

# How Offbeat reads your script

= Offbeat uses Fountain, a plain-text screenplay format. Type normally and the page formats itself. Files stay readable in any text editor, and open in Beat on Mac and iOS.

INT. SCENE HEADINGS - DAY

Start a line with INT., EXT., EST., INT./EXT. or I/E after a blank line and it becomes a scene heading. Offbeat capitalizes it for you and numbers the scene in the margin.

.A FORCED HEADING

Start a line with a period to make anything a heading.

INT. CHARACTERS AND DIALOGUE - DAY

Write a name in capitals after a blank line, then the dialogue on the very next line. Press Tab on an empty line to start a character cue — the name types itself in capitals and autocomplete suggests names you have already used.

ALEX
This is dialogue.
(whispering)
This is a parenthetical. Press Tab on an empty line inside dialogue to add one.

SAM ^
And this is dual dialogue — add a caret after the second name.

@McCLANE
Use @ to force a character name that has lowercase letters.

INT. TRANSITIONS AND CENTERED TEXT - DAY

A line in capitals ending in TO: becomes a transition.

SMASH CUT TO:

>Start a line with > to force a transition.

>Wrap text in > and < to center it.<

INT. EMPHASIS - DAY

Use *italics*, **bold**, ***bold italics*** and _underline_. Escape a literal asterisk with a backslash: \\*.

~Lines starting with a tilde are lyrics.

!AN ACTION LINE IN CAPITALS — the exclamation mark keeps it from becoming a character name.

INT. NOTES AND OMITTED TEXT - DAY [[COLOR GREEN]]

[[Double brackets make a note. Notes never print.]]

/* Text between slash-asterisk pairs is omitted (the "boneyard"). It stays in the file but never prints. */

Add a note like COLOR RED (or BLUE, GREEN, ORANGE, PURPLE…) in double brackets to a scene heading to color-code it in the outline, cards and timeline. Right-click a scene in the outline to pick a color.

# Structure

## Sections and synopses

= A line starting with = is a synopsis. It shows on the index card for its scene and never prints.

Lines starting with # are sections (## and ### for sub-sections). They organize the outline but never print.

===

Three equals signs force a page break.

INT. SHORTCUTS - DAY

Enter after dialogue or action adds a blank line automatically; Shift+Enter adds a single line break. Ctrl+G jumps to any scene. Ctrl+E toggles the print preview. Ctrl+Shift+K opens the index cards — drag them to reorder scenes.
`
};
