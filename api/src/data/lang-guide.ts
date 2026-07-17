// The Mathematical Language Style Guide, Grades K-8 — Doreen's language
// authority for all generated instructional text, adopted 2026-07-16 from the
// source PDF "Mathematical_Language_Style_Guide_Grades_K8.pdf" (16 pages).
// The guide identifies language and shortcuts that create misconceptions or
// fail to generalize; it is NOT a prohibition list — student-friendly language
// may bridge, but must be connected promptly to accurate vocabulary.
//
// LANG_GUIDE_CONTENT is the full text (tables flattened to "Older practice ->
// Preferred practice (why)" entries). PDF text extraction dropped the math
// operators inside expressions (e.g. "7 5 10 2" for "7 + 5 = 10 + 2"); every
// expression below was reconstructed from its row's surrounding prose. The
// absolute-value row lost both its example and its entire "why" cell to
// extraction truncation: the example is omitted rather than guessed, and the
// parenthetical "why" on that row is EDITORIAL — restated from the row's own
// "nonnegative" wording and Implementation Rule 5's |0| = 0 boundary case,
// not recovered source text. LANG_GUIDE_CORE is a compression for the
// scope-side card prompts; where they could ever disagree, the full text wins.

export const LANG_GUIDE_NAME = 'Mathematical Language Style Guide, Grades K-8'
export const LANG_GUIDE_VERSION = 'v1.0 (adopted 2026-07-16)'

export const LANG_GUIDE_CONTENT = `MATHEMATICAL LANGUAGE STYLE GUIDE, GRADES K-8

PURPOSE
This guide identifies language and shortcuts that can create misconceptions or fail to generalize. It is not a list of words that teachers must prohibit. Student-friendly language may be used as a bridge, but explicit instruction should connect it promptly to accurate mathematical vocabulary, representations, and reasoning.

COMPATIBILITY WITH DIRECT INSTRUCTION
These recommendations support direct instruction:
- State the concept and precise vocabulary explicitly.
- Model it with carefully selected examples and nonexamples.
- Connect the procedure to a representation or mathematical property.
- Use guided practice with immediate corrective feedback.
- Move to independent practice and cumulative review.
- Require accurate, efficient procedures after their meaning has been established.
The Institute of Education Sciences (IES) practice guide for elementary intervention gives strong-evidence ratings to both systematic instruction and explicit teaching of clear mathematical language. It includes teacher modeling, guided practice, feedback, and cumulative review. The guide therefore does not require discovery learning or prohibit standard algorithms. (IES: Assisting Students Struggling with Mathematics)

Each entry below: OLDER PRACTICE -> PREFERRED PRACTICE (why).

1. GENERAL MATHEMATICAL LANGUAGE AND NOTATION
- "The equals sign means the answer comes next." -> "The equals sign means has the same value as." Read 7 + 5 = 10 + 2 as "seven plus five has the same value as ten plus two." (An answer-oriented interpretation interferes with later equation solving and relational reasoning.)
- Using only equations of the form 3 + 4 = [box] -> Include forms such as [box] = 3 + 4, 3 + 4 = 5 + 2, and 8 = [box] + 3. (Varied equation forms strengthen relational understanding of equality.)
- Writing 8 + 4 = 12 - 5 = 7 to record consecutive actions -> Write separate valid equations: 8 + 4 = 12, then 12 - 5 = 7. (Every equals sign must connect expressions with equal values.)
- Calling every mathematical statement a "number sentence" -> Distinguish an expression (4x + 3), an equation (4x + 3 = 15), and an inequality (4x + 3 < 15). (The distinctions become essential in upper-elementary and middle-school mathematics.)
- "The answer" in every situation -> Use sum, difference, product, quotient, value, solution, estimate, or measure, as appropriate. (Names the mathematical object or result precisely. "Answer" may still be used conversationally.)
- "These are the same." -> Specify equal in value, equivalent, congruent, similar, or identical, as appropriate. ("Same" can hide important mathematical distinctions.)
- "Do the problem." -> "Evaluate the expression," "solve the equation," "compare the quantities," or "find the measure." (Clarifies what mathematical action is required.)
- "Show your work." -> "Show enough reasoning, equations, labels, or representations for someone to follow and verify your solution." (Defines the evidence expected instead of rewarding unnecessary writing.)
- "Simplify" and "solve" used interchangeably -> Simplify/evaluate an expression; solve an equation or inequality. (Expressions do not have solutions unless they are part of a condition such as an equation.)
- Using vocabulary only after students have informally described an idea -> Explicitly introduce the student-friendly phrase and formal term together: "A corner is called a vertex." (Clear, concise mathematical language supports communication and future learning.)
- Correcting every informal phrase immediately, even when the student's reasoning is clear -> Revoice accurately: "Yes, the shape has four corners — four vertices." Then have the student use the term. (Preserves the student's reasoning while strengthening vocabulary.)

2. WHOLE NUMBERS, PLACE VALUE, ADDITION, AND SUBTRACTION
- "Borrow from the number next door." -> "Regroup one ten as ten ones," or "exchange one hundred for ten tens." (Nothing is borrowed or returned; the quantity is renamed using place-value equivalence.)
- "Carry the one." -> "Regroup ten ones as one ten," naming the unit being recorded. ("One" is ambiguous; the recorded digit may represent a ten, hundred, or another unit.)
- Treating regrouping as outdated -> Use regrouping or exchanging as the preferred terminology. (These terms accurately describe composing or decomposing equivalent place-value units.)
- "Add a zero when multiplying by 10." -> "Multiplying by 10 makes each digit's value ten times as great; each digit occupies the next place to the left." ("Add a zero" does not generalize to decimals and hides the base-ten relationship.)
- "Move the decimal point." -> "Multiplying or dividing by a power of ten changes each digit's place value." Then describe the resulting digit movement. (The shortcut alone encourages errors about direction and number of places.)
- "Zero has no value." -> "Zero is a number. A zero digit may also hold a place so the other digits retain their values." (Zero has mathematical value and an essential place-value role.)
- Reading 4.36 only as "four point three six" -> During place-value development, read it as "four and thirty-six hundredths." Later teach both readings. (The place-value reading makes the fraction and decimal structure explicit.)
- "The decimal with more digits is larger." -> Compare corresponding place values, using equivalent forms when useful: 0.5 = 0.50 > 0.45. (Decimal magnitude depends on place value, not the number of digits.)
- "Five or more, raise the score; four or less, let it rest." -> Identify the rounding place, locate the two neighboring benchmarks, and choose the nearer one; explicitly teach the midpoint convention. (Builds magnitude understanding and generalizes beyond a rhyme.)
- "Always put the bigger number on top when subtracting." -> Preserve the stated order: minuend - subtrahend. Introduce negative results when grade-appropriate. (Subtraction is not commutative, and the rule prevents meaningful work with negative numbers.)
- Teaching subtraction only as "take away" -> Explicitly teach removal, comparison, missing-addend, and distance interpretations. (Many subtraction situations do not involve physically taking something away.)
- "Turn-around facts" as a universal rule -> Name the commutative property and state that it applies to addition and multiplication — not subtraction and division. (Prevents overgeneralization to noncommutative operations.)
- "Fact family" without identifying relationships -> Use "related equations" and explicitly name the inverse relationship between addition/subtraction or multiplication/division. (Focuses attention on mathematical structure rather than a worksheet pattern.)
- "Count the numbers" when finding how many -> "Count each object once; the last number named tells how many objects are in the set." (Distinguishes rote number-word recitation from cardinality.)

3. MULTIPLICATION AND DIVISION
- Defining multiplication only as repeated addition -> For whole numbers, begin with equal groups and arrays; also teach comparison, area, combinations, and scaling. (Repeated addition does not adequately describe fractional, decimal, or negative multiplication.)
- "Multiplication always makes a number bigger." -> "Multiplication scales a quantity." Compare factors greater than 1, between 0 and 1, equal to 1, zero, and negative factors when appropriate. (Products can be greater than, equal to, or less than the original number.)
- "Division always makes a number smaller." -> Interpret division through equal groups, measurement, sharing, and scaling. (Division by numbers between 0 and 1 can make the quotient larger.)
- "How many times does 4 go into 20?" -> "How many groups of 4 are in 20?" or "Twenty divided by four." (Makes the quantities and division interpretation visible.)
- Treating division only as sharing -> Teach both partitive division — number in each group — and measurement division — number of groups. (Students need both interpretations for fractions, rates, and algebra.)
- Always recording a result as 17 R 3 -> Write 17 R 3 only as an intermediate whole-number result when appropriate; interpret it as 17 3/4, 17.75, 17 with 3 left over, or 18, depending on the context. (A remainder is part of the quantity and must be interpreted, not merely tagged with "R.")
- "Drop the remainder" or "round the remainder" automatically -> Ask what the remainder represents and whether the context requires discarding it, using it, converting it, or rounding the quotient up. (Different contexts require different treatments.)
- "You cannot divide a smaller number by a larger number." -> "The quotient will be between 0 and 1 when a positive smaller number is divided by a positive larger number." (Such division produces a valid fraction or decimal.)
- "You cannot divide by zero because the calculator says error." -> Explain that division asks for a number that satisfies a multiplication relationship; no number multiplied by zero produces a nonzero dividend. (Gives a mathematical reason and prepares students for algebra.)
- Mixing the roles of divisor and dividend -> Use and revisit dividend / divisor = quotient, connected to a context and equation. (Precise roles improve interpretation of division expressions.)

4. FRACTIONS, DECIMALS, RATIOS, AND PERCENTS
- "Top number" and "bottom number" as the only vocabulary -> Use numerator and denominator, while initially pairing them with location. (Location language does not explain each number's role.)
- Defining a fraction as "one number over another" -> "A fraction is one number that represents a magnitude; a/b also represents a divided by b." (Fractions are numbers, not two unrelated whole numbers.)
- Using "out of" as the complete definition of every fraction -> State the unit or whole, require equal-sized parts, and name the relevant fraction interpretation: part-whole, measure, quotient, ratio, or operator. ("Out of" is inadequate for fractions greater than 1 and many ratio or measurement situations.)
- Reading 3/4 only as "three over four" -> Prefer "three-fourths"; also connect it to "three divided by four" when relevant. (Names the fraction as a number and supports division understanding.)
- "Improper fraction" -> Prefer fraction greater than or equal to one or fraction in fraction form, while teaching "improper fraction" if students will encounter it. ("Improper" can imply the representation is wrong, although it is often the most useful form.)
- "Reduce the fraction." -> "Simplify the fraction" or "write an equivalent fraction in lowest terms." (The value is not reduced; only the representation changes.)
- "Cancel the numbers." -> "Divide the numerator and denominator by the same nonzero factor," or "divide out a common factor." (Makes the preservation of value explicit.)
- "Cross-cancel." -> Identify common factors in a numerator and denominator of a product and divide by the same factor. (Only factors — not terms joined by addition — may be divided out this way.)
- The "butterfly method" for fraction addition or comparison -> Generate equivalent fractions with a common denominator, or compare using benchmarks, number lines, or multiplicative reasoning. (The butterfly pattern hides why the method works and does not develop fraction magnitude.)
- "Multiply the denominators to get a common denominator." -> Find a common multiple, preferably an efficient one such as the least common multiple when useful. (The product works but may create unnecessarily large numbers and obscure structure.)
- "Keep-change-flip." -> "Dividing by a nonzero number is equivalent to multiplying by its reciprocal." Derive and model the relationship before abbreviating the procedure. (The rule is accurate only when its referents and justification are understood.)
- "Line up the decimals" as the full explanation for addition or subtraction -> "Align digits with the same place value; therefore, the decimal points align." (Place value — not the visual location of a dot — is the governing idea.)
- "Move the decimal two places to make a percent." -> "Percent means a rate per 100. Multiplying by 100 changes the decimal representation to percent form." (Connects the conversion to meaning and helps students interpret percents above 100% or below 1%.)
- "A percent is part of 100, so it cannot exceed 100%." -> "Percent means per 100; percentages can be greater than 100%." (Growth, comparisons, and repeated quantities often produce percents above 100%.)
- Comparing fractions solely by cross-products -> Use common denominators, common numerators, benchmarks, number lines, or cross-products derived from equivalent fractions. (Multiple comparison strategies build magnitude and flexibility.)
- Showing fractions almost exclusively with shaded circles -> Use number lines as a central representation, along with area, set, and length models. (Number lines emphasize that fractions are numbers with magnitudes.)
The IES fractions guide specifically recommends treating fractions as numbers, using number lines, explaining why fraction procedures make sense, and developing ratio and proportion understanding before cross-multiplication. (IES: Developing Effective Fractions Instruction K-8)

5. PROPORTIONAL REASONING
- Teaching "cross-multiply and divide" as the first proportion method -> Begin with equivalent ratios, scale factors, unit rates, tables, double number lines, and equations. Then derive ad = bc for a/b = c/d. (Cross-multiplication is valid, but premature use can replace proportional reasoning with an unexplained trick.)
- "Cross-multiplication works whenever there are two fractions." -> Use cross-products only for an equation of two ratios or for a justified fraction comparison — not for fraction addition or unrelated expressions. (Restricts the procedure to situations where it is mathematically valid.)
- "The numbers go up by the same amount, so it is proportional." -> "A proportional relationship has a constant multiplicative factor or constant ratio." (Constant additive change does not establish proportionality.)
- Using a proportion for every percent problem -> Choose among unit rate, scaling, benchmark percents, equations, tables, or proportions. (Different number relationships favor different efficient strategies.)
- "Per always means divide." -> Identify the two quantities and interpret the rate; then determine the appropriate operation from the relationship. (A word alone does not determine the mathematical structure.)

6. INTEGERS AND RATIONAL NUMBERS
- Calling every dash a "minus sign" -> Distinguish the subtraction symbol, negative sign, and opposite sign from context. (The same notation can represent an operation or a number's sign.)
- "Two negatives make a positive." -> Specify: "The product or quotient of two negative numbers is positive." For subtraction, rewrite as addition of the opposite. (The slogan is false for expressions such as -3 - 4.)
- "Same-change-change" for integer subtraction -> "Subtracting a number is equivalent to adding its opposite," supported by equations and number-line or quantity models. (Names the mathematical relationship instead of a pattern of symbol changes.)
- "Absolute value makes a number positive." -> "Absolute value is distance from zero, so it is nonnegative." (Zero's absolute value is zero, not positive.)
- "A negative number with larger digits is larger." -> Compare positions on a number line: farther right is greater. (For negative numbers, greater absolute value means farther left and therefore less.)
- Using only "up/down" rules on a number line -> State direction and magnitude: addition of a positive moves right; addition of a negative moves left. (Connects movement to the operation and the signed quantity.)
- Defining integers as "positive and negative whole numbers" -> "Integers are whole numbers, their opposites, and zero." (Prevents the common omission or double-classification of zero.)

7. ORDER OF OPERATIONS, EXPRESSIONS, AND ALGEBRA
- "PEMDAS means multiply before divide and add before subtract." -> Multiplication and division have equal priority and are performed left to right; addition and subtraction likewise have equal priority. (The mnemonic is frequently misread as six separate priority levels.)
- "Always do parentheses first." -> Use grouping symbols to identify grouped expressions; evaluate the operations inside each group according to structure and order. (Parentheses organize expressions but do not replace the operation rules inside them.)
- "An exponent tells you what to multiply the base by." -> "The exponent tells how many factors of the base appear." For example, 3^4 = 3 x 3 x 3 x 3. (Prevents confusing 3^4 with 3 x 4.)
- "Plug and chug." -> Substitute the stated value, preserve grouping, and evaluate the resulting expression. (Names the two distinct mathematical actions.)
- "Move the term to the other side and change its sign." -> Apply the same inverse operation to both sides, or add an equivalent expression to both sides. (Maintains equality and generalizes to more complex equations.)
- "Get rid of the 3." -> Identify the operation involving 3 and apply an inverse operation while preserving equality. (Mathematical objects do not disappear; equivalent transformations are performed.)
- "Cancel the x's." -> Divide out a common nonzero factor, or combine additive inverse terms, naming the relevant property. ("Cancel" can encourage invalid cancellation across addition.)
- "Distribute the outside number to everything inside." -> "Multiply the factor outside the parentheses by each term inside," connecting the step to the distributive property. (Distinguishes terms from individual digits, factors, or symbols.)
- Teaching FOIL as a general multiplication rule -> Use the distributive property or an area/partial-products model; identify FOIL, if used, as shorthand for one special case involving two binomials. (The distributive property generalizes to all polynomial products; FOIL does not.)
- "Combine anything that looks alike." -> Combine like terms — terms with identical variable parts and exponents — by operating on their coefficients. (Visual similarity alone does not make terms like terms.)
- Treating x as always meaning multiplication -> In algebra, use x as a variable and use a centered dot, parentheses, or juxtaposition for multiplication when ambiguity is possible. (Prevents confusion between a variable and an operation symbol.)
- "Rise over run" as the entire definition of slope -> Define slope as rate of change: (change in y)/(change in x), with attention to direction, units, and the undefined slope of a vertical line. (Connects the formula to covariation, graphs, tables, and contexts.)
- "The variable is a mystery number." -> Describe a variable as a symbol representing a number or varying quantity, depending on the context. (Variables have roles beyond a single unknown value.)
- "Letters can stand for anything." -> State the domain, quantity, and unit represented by each variable. (Variables are constrained by the mathematical situation.)
The IES algebra guide recommends solved examples, language that exposes algebraic structure, and teaching students to compare and intentionally select valid strategies. These practices are compatible with explicit teacher modeling. (IES: Teaching Strategies for Improving Algebra Knowledge)

8. GEOMETRY AND MEASUREMENT
- "Diamond" as the mathematical name of a shape -> Rhombus, when the figure is a quadrilateral with four congruent sides. ("Diamond" usually describes orientation, not a geometric category.)
- "Corner" as the only term -> Pair the informal word with vertex; plural vertices. (Establishes precise vocabulary needed for geometry.)
- Calling every straight drawing a "line" -> Distinguish line, line segment, and ray. (These objects have different endpoint properties.)
- "A square is not a rectangle." -> "A square is a special rectangle and a special rhombus." (Inclusive definitions support classification and hierarchical reasoning.)
- "A rectangle has two long sides and two short sides." -> "A rectangle is a quadrilateral with four right angles." (A rectangle may have four congruent sides; side length is not its defining property.)
- "A triangle has a bottom and points upward." -> Define a triangle by three straight sides and three vertices; show varied orientations, sizes, and types. (Prototype-only examples can cause students to reject valid triangles.)
- "The base is the bottom side." -> "Any selected side may serve as a base; the corresponding height is perpendicular to that base." (Base is a mathematical role, not a fixed visual position.)
- "Length times width" for every area problem -> Use base x corresponding height for parallelograms; derive and name formulas for other figures. ("Length" and "width" become ambiguous in rotated or nonrectangular figures.)
- "The height is the vertical side." -> "Height is the perpendicular distance from the base to the opposite vertex or parallel side." (Height may be inside, outside, or not coincide with a side.)
- "Flip, slide, and turn" as the final vocabulary -> Connect to reflection, translation, and rotation. (Formal terminology identifies transformations and their invariant properties.)
- "Same shape" for both congruent and similar figures -> Congruent means same shape and size; similar means corresponding angles are equal and corresponding lengths are proportional. (Separates two different geometric relationships.)
- "The perimeter is the outside and area is the inside." -> Perimeter is a one-dimensional boundary length; area is a two-dimensional measure of a region. (Emphasizes measurable attributes and their units.)
- Omitting units until the final answer -> Name and track linear, square, and cubic units throughout the work. (Units are part of the quantity and support dimensional reasoning.)
- "Volume is how much a container holds" in every case -> Distinguish volume of a three-dimensional region from capacity of a container, while connecting the measures. (The concepts are related but not identical.)

9. WORD PROBLEMS, DATA, AND PROBABILITY
- Keyword rules such as "altogether means add" or "left means subtract" -> Identify the quantities, what is unknown, and the relationship among them; represent that relationship with a diagram, table, equation, or model. (The same word can appear in problems requiring different operations.)
- "Circle the numbers and choose an operation." -> Identify relevant and irrelevant information, label quantities and units, and construct a mathematical representation. (Numbers alone do not reveal the problem structure.)
- "Use CUBES" or another acronym as the mathematical reasoning -> Acronyms may organize reading, but explicitly teach problem types, quantitative relationships, representations, and solution monitoring. (A reading checklist cannot replace mathematical analysis.)
- Requiring one fixed strategy for every word problem -> Explicitly teach a small repertoire of representations and strategies, then model how to select an efficient one. (Builds flexibility without withholding clear instruction.)
- "Average" without qualification -> Specify mean, median, mode, or another intended measure. ("Average" is used informally for several different statistics.)
- "The mean is the middle." -> Mean is the equal-share or balance value; median is the middle ordered value. (Prevents confusion between two measures of center.)
- Treating graphs as pictures without attention to scale -> Explicitly read the title, variables, units, intervals, scale, and source before interpreting the data. (Visual impressions can be misleading when scales differ or are truncated.)
- Calling a line plot and a line graph the same thing -> A line plot/dot plot displays individual data values on a number line; a line graph connects values, often across time. (The displays represent data differently.)
- "Probability tells what will happen." -> "Probability quantifies how likely an event is, from 0 to 1 or 0% to 100%." (A probability describes uncertainty, not a guaranteed individual outcome except at 0 or 1.)
- "Theoretical probability should exactly match an experiment." -> Experimental relative frequency tends to stabilize near theoretical probability over many trials, while short-run variation is expected. (Distinguishes a model from a finite sample.)
The IES problem-solving guide supports explicit instruction in visual representations, monitoring, mathematical concepts and notation, and multiple strategies. (IES: Improving Mathematical Problem Solving in Grades 4-8)

IMPLEMENTATION RULES
1. Pair accessible and precise language. Use the child-friendly phrase as a bridge: "This corner is called a vertex." "We are breaking apart one ten into ten ones; that is regrouping." "The two sides have the same value; they are equal." Do not require students to infer formal vocabulary from examples alone.
2. Explain before abbreviating. A mnemonic or shortcut may be introduced only after students can identify: what the procedure does; why it preserves value or equality; when it is valid; when it is not valid.
3. Do not prohibit efficient standard methods. Standard algorithms, cross-products, multiplying by a reciprocal, and algebraic transformations are legitimate mathematics. The concern is teaching them as unexplained tricks or using them before students possess the prerequisite meaning.
4. Use consistent terminology across grades. Teachers should agree on a small set of vertical language commitments, particularly: equals means "has the same value as"; regroup rather than borrow or carry; numerator and denominator rather than top and bottom number; interpret remainders in context; multiplication and division are not guaranteed to make quantities larger or smaller; apply operations to both sides rather than "move and change"; distributive property rather than FOIL as the general method; proportional reasoning before cross-multiplication.
5. Use examples and nonexamples. For each important term, explicitly model boundary cases: a rotated square is still a square; 0.5 x 8 < 8; 8 / 0.5 > 8; 5 + 2 = 4 + 3; 125% = 1.25; |0| = 0; a vertical line has undefined slope.
6. Correct language without interrupting reasoning. Use recasting: Student: "I borrowed from the 5." Teacher: "You regrouped one ten as ten ones. Show me where those ten ones appear." Then require accurate language during the worked example or response.

RESEARCH BASIS
This guide synthesizes the following principles: Clear mathematical language should be explicitly taught as part of systematic instruction (IES elementary mathematics intervention guide). Fractions should be treated as numbers with magnitudes; number lines should be central; procedures should be explained; proportional reasoning should precede cross-multiplication (IES fractions guide). Students benefit from explicit use of representations, notation, reflection, and multiple problem-solving strategies (IES problem-solving guide). Algebra instruction should expose structure through precise language, solved examples, and comparisons of strategies (IES algebra guide). Procedural fluency includes accuracy, efficiency, flexibility, and appropriate strategy selection — not merely rote execution (NCTM position statement on procedural fluency). K-8 language should remain consistent with grade-level meanings of operations, properties, representations, and mathematical precision (Common Core State Standards for Mathematics). Varied equation forms support a relational rather than "operations produce an answer" interpretation of the equals sign (McNeil et al., research on equal-sign understanding).

FINAL POLICY STATEMENT
The schoolwide goal is not to ban informal language. It is to ensure that teacher explanations and student practice move from accessible wording to terminology and procedures that are mathematically accurate, conceptually meaningful, and durable across later grades.`

/**
 * The card-writing compression for the scope-side prompts (course map, unit
 * planning, lesson-card generation) — the vertical commitments plus the
 * highest-frequency substitutions. The full LANG_GUIDE_CONTENT (in the VSG
 * system prompt) is authoritative where they could ever disagree.
 */
export const LANG_GUIDE_CORE = `MATHEMATICAL LANGUAGE STYLE GUIDE (${LANG_GUIDE_VERSION}) — binding on every field of instructional text you write (objectives, approach, boundary, exemplars, student-friendly titles). It targets language that creates misconceptions or fails to generalize; it is NOT a ban list — accessible wording may bridge, but pair it promptly with the precise term.
Vertical language commitments: equals means "has the same value as" (never "the answer comes next"); regroup/exchange, never borrow or carry; numerator and denominator, never top/bottom number; interpret remainders in context (17 R 3 is only an intermediate form — 17 3/4, 17.75, "17 with 3 left over", or 18, as the context demands); multiplication and division are NOT guaranteed to make quantities larger or smaller — multiplication scales; apply the same operation to both sides, never "move the term and change its sign"; distributive property, never FOIL as the general method; proportional reasoning before cross-multiplication.
Further preferred practice: simplify a fraction (never "reduce"); fraction greater than or equal to one (prefer over "improper fraction"); "how many groups of 4 are in 20" (never "4 goes into 20"); sum/difference/product/quotient/value/solution/measure, not "the answer" as a technical term; equal in value/equivalent/congruent/similar, not "the same"; expression vs equation vs inequality, not "number sentence" for everything; minuend - subtrahend order preserved (never "bigger number on top"); place-value language for x10 and decimal shifts (never "add a zero" / "move the decimal" as the explanation); rounding via neighboring benchmarks and the midpoint convention, not the rhyme; commutative property named and scoped to addition and multiplication ("turn-around facts" overgeneralizes); related equations with the inverse relationship named, over "fact family"; both partitive AND measurement division; number lines central for fractions (not only shaded circles); "out of" is not a complete fraction definition; keep-change-flip / butterfly / cross-cancel only AFTER the relationship they abbreviate is derived (explain before abbreviating); rhombus not "diamond"; vertex paired with "corner"; line vs line segment vs ray; a square IS a special rectangle; any side may serve as base, height is the perpendicular distance; reflection/translation/rotation paired with flip/slide/turn; congruent vs similar distinguished; perimeter is boundary LENGTH, area a measure of a region; units named and tracked throughout, not only in the final answer; never keyword rules ("altogether means add") — represent quantities and relationships instead; mean/median/mode specified, never bare "average" as the technical term; probability quantifies likelihood from 0 to 1, never "tells what will happen"; integers are whole numbers, their opposites, and zero; absolute value is distance from zero (nonnegative); the exponent counts factors of the base (3^4 = 3 x 3 x 3 x 3, not 3 x 4); multiplication and division carry EQUAL priority left to right (PEMDAS is misread otherwise); slope is a rate of change, not just "rise over run"; a variable represents a number or varying quantity with a stated domain/quantity/unit, never a "mystery number".
Standard algorithms and efficient methods are never prohibited (they are legitimate mathematics); the concern is unexplained tricks before meaning. Use examples AND nonexamples for boundary cases (a rotated square is still a square; 0.5 x 8 < 8; 8 / 0.5 > 8; 125% = 1.25; |0| = 0).
Two precedence carve-outs. (1) ASSESSMENT MIRRORING: verbatim released-item quotes, and generated exemplars required to mirror a real assessment program's conventions, keep the PROGRAM'S own wording — if the framework's genuine items say "number sentence", "improper fraction", or "reduce to lowest terms", the exemplar says what the item says (faithful quotation, not older practice); the guide governs YOUR OWN instructional prose around them. (2) TITLES: the student-friendly title's precision ruling (item 17) outranks the guide — where the framework's formal term for the behavior is one the guide deprecates, the title keeps the framework's term rather than losing standard-alignment; never rewrite a precise title merely to conform vocabulary.`

/**
 * Mechanical review-pass watch list: high-precision markers of the guide's
 * "older practice" column. A hit is a review FLAG, never a hard fail — the
 * guide explicitly allows bridge language when promptly paired with the
 * precise term; the flag asks a reviewer to verify that pairing happened.
 */
export const LANG_GUIDE_WATCH: { re: RegExp; prefer: string; vsgSanctioned?: boolean }[] = [
  // "borrow" needs regrouping context — everyday borrowing (library books,
  // simple-interest stems "You borrow $500 at 5%") is conforming vocabulary.
  { re: /\bborrow(?:s|ed|ing)?\b(?=[^.!?]{0,60}?(?:\b(?:one|ten|tens|hundred|hundreds|thousand|place|column|digit|regroup|rename|subtract)\b|\bnext door\b|from the \d))/i, prefer: 'regroup/exchange, naming the place-value units' },
  { re: /\bcarr(?:y|ies|ied|ying) the (?:one|1|ten|digit)\b/i, prefer: 'regroup ten ones as one ten, naming the unit' },
  { re: /\bkeep[\s,-]{0,2}change[\s,-]{0,2}flip\b/i, prefer: 'dividing by a nonzero number is multiplying by its reciprocal (derive before abbreviating)' },
  { re: /\bcross[-\s]?cancel/i, prefer: 'divide a numerator and denominator of the product by the same factor' },
  // The fraction-comparison trick only — a butterfly with a line of symmetry
  // or six legs is conforming K-4 content.
  { re: /\bbutterfl(?:y|ies)[\s-](?:method|trick|shortcut)\b|\bbutterfl(?:y|ies)\b(?=[^.!?]{0,50}?\b(?:fraction|denominator|numerator)s?\b)/i, prefer: 'equivalent fractions with a common denominator, benchmarks, or number lines' },
  { re: /\breduc(?:e|es|ed|ing)\b[^.!?]{0,20}?\bfractions?\b/i, prefer: 'simplify the fraction / write it in lowest terms' },
  // "top/bottom number line" is double-number-line narration the guide itself recommends.
  { re: /\b(?:top|bottom) number\b(?!\s+lines?\b)/i, prefer: 'numerator / denominator (paired with location at first use)' },
  // Division phrasing only (digit after "into"); "the 1 goes into the tens
  // place" and "goes into the machine" are conforming. Inside ALGORITHM STEPS
  // the VSG's LANG 10/DEV 01 sanctions the format's "goes into" step wording
  // (A3 house style) — so the VSG scan skips this entry (vsgSanctioned).
  { re: /\b(?:go|goes|went) into\b[^.!?]{0,20}?\d/i, prefer: '"how many groups of N are in M" or "M divided by N" (in VSG algorithm steps, LANG 10/DEV 01\'s "goes into" step wording stands)', vsgSanctioned: true },
  // "add a zero pair" is conventional integer chip-model language.
  { re: /\badd (?:a |one |two |three )?zero(?:e?s)?\b(?!\s+pairs?\b)/i, prefer: 'each digit\'s value becomes ten times as great; digits shift one place left' },
  { re: /\bmove the decimal\b/i, prefer: 'multiplying/dividing by a power of ten changes each digit\'s place value' },
  { re: /\bbigger number on top\b/i, prefer: 'preserve the stated order: minuend - subtrahend' },
  { re: /\bturn[-\s]?around fact/i, prefer: 'name the commutative property, scoped to addition and multiplication' },
  { re: /\bsame[\s,-]{1,2}change[\s,-]{1,2}change\b/i, prefer: 'subtracting a number is adding its opposite' },
  { re: /\bplug[\s-]and[\s-]chug\b/i, prefer: 'substitute the stated value, preserve grouping, evaluate' },
  { re: /\bnumber sentence\b/i, prefer: 'expression, equation, or inequality — whichever it is (verbatim released-item quotes keep their program\'s own wording)' },
  { re: /\btwo negatives make a positive\b/i, prefer: 'the product or quotient of two negative numbers is positive (the slogan fails for -3 - 4)' },
  { re: /\bmystery number\b/i, prefer: 'a symbol representing a number or varying quantity' },
  { re: /\bFOIL\b/, prefer: 'the distributive property (FOIL is shorthand for one binomial special case)' },
  { re: /\bdiamond\b/i, prefer: 'rhombus (diamond describes orientation, not a category)' },
]

/**
 * Scan student-facing / instructional text and return distinct guide flags.
 * `forVsg` skips entries the VSG rulebook itself sanctions (LANG 10/DEV 01
 * keeps the format's "goes into" wording inside algorithm steps — A3 outranks
 * the guide's A5, so flagging every long-division script would be noise).
 */
export function langGuideFindings(texts: string[], opts?: { forVsg?: boolean }): string[] {
  const found = new Map<string, string>()
  for (const t of texts) {
    for (const w of LANG_GUIDE_WATCH) {
      if (opts?.forVsg && w.vsgSanctioned) continue
      const m = w.re.exec(t)
      if (m && !found.has(w.re.source)) found.set(w.re.source, `"${m[0]}" — prefer: ${w.prefer}`)
    }
  }
  return [...found.values()]
}
