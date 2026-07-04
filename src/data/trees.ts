import type { StandardNode } from '../types'

// Content standards only. Practice / process / implementation standards
// (Standards for Mathematical Practice, TEKS §111.26(b)(1) process standards)
// are excluded at ingestion: they describe how students think, communicate,
// justify, model, or persevere — not assessable mathematical content.

export const ccssG4Tree: StandardNode[] = [
  {
    code: '4.OA',
    norm: '4.OA',
    label: 'Operations & Algebraic Thinking',
    children: [
      {
        code: '4.OA.A',
        norm: '4.OA.A',
        label: 'Use the four operations with whole numbers to solve problems.',
        children: [
          {
            code: '4.OA.A.1',
            norm: '4.OA.1',
            wording:
              'Interpret a multiplication equation as a comparison, e.g., interpret 35 = 5 × 7 as a statement that 35 is 5 times as many as 7 and 7 times as many as 5. Represent verbal statements of multiplicative comparisons as multiplication equations.',
            emphasis: 'Major',
          },
          {
            code: '4.OA.A.2',
            norm: '4.OA.2',
            wording:
              'Multiply or divide to solve word problems involving multiplicative comparison, e.g., by using drawings and equations with a symbol for the unknown number to represent the problem, distinguishing multiplicative comparison from additive comparison.',
            emphasis: 'Major',
          },
          {
            code: '4.OA.A.3',
            norm: '4.OA.3',
            wording:
              'Solve multistep word problems posed with whole numbers and having whole-number answers using the four operations, including problems in which remainders must be interpreted. Represent these problems using equations with a letter standing for the unknown quantity. Assess the reasonableness of answers using mental computation and estimation strategies including rounding.',
            emphasis: 'Major',
          },
        ],
      },
      {
        code: '4.OA.B',
        norm: '4.OA.B',
        label: 'Gain familiarity with factors and multiples.',
        children: [
          {
            code: '4.OA.B.4',
            norm: '4.OA.4',
            wording:
              'Find all factor pairs for a whole number in the range 1–100. Recognize that a whole number is a multiple of each of its factors. Determine whether a given whole number in the range 1–100 is a multiple of a given one-digit number. Determine whether a given whole number in the range 1–100 is prime or composite.',
            emphasis: 'Supporting',
          },
        ],
      },
      {
        code: '4.OA.C',
        norm: '4.OA.C',
        label: 'Generate and analyze patterns.',
        children: [
          {
            code: '4.OA.C.5',
            norm: '4.OA.5',
            wording:
              'Generate a number or shape pattern that follows a given rule. Identify apparent features of the pattern that were not explicit in the rule itself. For example, given the rule “Add 3” and the starting number 1, generate terms in the resulting sequence and observe that the terms appear to alternate between odd and even numbers. Explain informally why the numbers will continue to alternate in this way.',
            emphasis: 'Additional',
          },
        ],
      },
    ],
  },
  {
    code: '4.NBT',
    norm: '4.NBT',
    label: 'Number & Operations in Base Ten',
    limits: ['Grade 4 expectations in this domain are limited to whole numbers ≤ 1,000,000.'],
    children: [
      {
        code: '4.NBT.A',
        norm: '4.NBT.A',
        label: 'Generalize place value understanding for multi-digit whole numbers.',
        children: [
          {
            code: '4.NBT.A.1',
            norm: '4.NBT.1',
            wording:
              'Recognize that in a multi-digit whole number, a digit in one place represents ten times what it represents in the place to its right. For example, recognize that 700 ÷ 70 = 10 by applying concepts of place value and division.',
            emphasis: 'Major',
          },
          {
            code: '4.NBT.A.2',
            norm: '4.NBT.2',
            wording:
              'Read and write multi-digit whole numbers using base-ten numerals, number names, and expanded form. Compare two multi-digit numbers based on meanings of the digits in each place, using >, =, and < symbols to record the results of comparisons.',
            emphasis: 'Major',
          },
          {
            code: '4.NBT.A.3',
            norm: '4.NBT.3',
            wording: 'Use place value understanding to round multi-digit whole numbers to any place.',
            emphasis: 'Major',
          },
        ],
      },
      {
        code: '4.NBT.B',
        norm: '4.NBT.B',
        label: 'Use place value understanding and properties of operations to perform multi-digit arithmetic.',
        children: [
          {
            code: '4.NBT.B.4',
            norm: '4.NBT.4',
            wording: 'Fluently add and subtract multi-digit whole numbers using the standard algorithm.',
            emphasis: 'Major',
            fluency: true,
          },
          {
            code: '4.NBT.B.5',
            norm: '4.NBT.5',
            wording:
              'Multiply a whole number of up to four digits by a one-digit whole number, and multiply two two-digit numbers, using strategies based on place value and the properties of operations. Illustrate and explain the calculation by using equations, rectangular arrays, and/or area models.',
            emphasis: 'Major',
          },
          {
            code: '4.NBT.B.6',
            norm: '4.NBT.6',
            wording:
              'Find whole-number quotients and remainders with up to four-digit dividends and one-digit divisors, using strategies based on place value, the properties of operations, and/or the relationship between multiplication and division. Illustrate and explain the calculation by using equations, rectangular arrays, and/or area models.',
            emphasis: 'Major',
          },
        ],
      },
    ],
  },
  {
    code: '4.NF',
    norm: '4.NF',
    label: 'Number & Operations — Fractions',
    limits: [
      'Grade 4 expectations in this domain are limited to fractions with denominators 2, 3, 4, 5, 6, 8, 10, 12, and 100.',
    ],
    children: [
      {
        code: '4.NF.A',
        norm: '4.NF.A',
        label: 'Extend understanding of fraction equivalence and ordering.',
        children: [
          {
            code: '4.NF.A.1',
            norm: '4.NF.1',
            wording:
              'Explain why a fraction a/b is equivalent to a fraction (n × a)/(n × b) by using visual fraction models, with attention to how the number and size of the parts differ even though the two fractions themselves are the same size. Use this principle to recognize and generate equivalent fractions.',
            emphasis: 'Major',
          },
          {
            code: '4.NF.A.2',
            norm: '4.NF.2',
            wording:
              'Compare two fractions with different numerators and different denominators, e.g., by creating common denominators or numerators, or by comparing to a benchmark fraction such as 1/2. Recognize that comparisons are valid only when the two fractions refer to the same whole. Record the results of comparisons with symbols >, =, or <, and justify the conclusions, e.g., by using a visual fraction model.',
            emphasis: 'Major',
          },
        ],
      },
      {
        code: '4.NF.B',
        norm: '4.NF.B',
        label:
          'Build fractions from unit fractions by applying and extending previous understandings of operations on whole numbers.',
        children: [
          {
            code: '4.NF.B.3',
            norm: '4.NF.3',
            wording: 'Understand a fraction a/b with a > 1 as a sum of fractions 1/b.',
            emphasis: 'Major',
            children: [
              {
                code: '4.NF.B.3.a',
                norm: '4.NF.3a',
                wording:
                  'Understand addition and subtraction of fractions as joining and separating parts referring to the same whole.',
              },
              {
                code: '4.NF.B.3.b',
                norm: '4.NF.3b',
                wording:
                  'Decompose a fraction into a sum of fractions with the same denominator in more than one way, recording each decomposition by an equation. Justify decompositions, e.g., by using a visual fraction model. Examples: 3/8 = 1/8 + 1/8 + 1/8; 3/8 = 1/8 + 2/8; 2 1/8 = 1 + 1 + 1/8 = 8/8 + 8/8 + 1/8.',
              },
              {
                code: '4.NF.B.3.c',
                norm: '4.NF.3c',
                wording:
                  'Add and subtract mixed numbers with like denominators, e.g., by replacing each mixed number with an equivalent fraction, and/or by using properties of operations and the relationship between addition and subtraction.',
              },
              {
                code: '4.NF.B.3.d',
                norm: '4.NF.3d',
                wording:
                  'Solve word problems involving addition and subtraction of fractions referring to the same whole and having like denominators, e.g., by using visual fraction models and equations to represent the problem.',
              },
            ],
          },
          {
            code: '4.NF.B.4',
            norm: '4.NF.4',
            wording:
              'Apply and extend previous understandings of multiplication to multiply a fraction by a whole number.',
            emphasis: 'Major',
            children: [
              {
                code: '4.NF.B.4.a',
                norm: '4.NF.4a',
                wording:
                  'Understand a fraction a/b as a multiple of 1/b. For example, use a visual fraction model to represent 5/4 as the product 5 × (1/4), recording the conclusion by the equation 5/4 = 5 × (1/4).',
              },
              {
                code: '4.NF.B.4.b',
                norm: '4.NF.4b',
                wording:
                  'Understand a multiple of a/b as a multiple of 1/b, and use this understanding to multiply a fraction by a whole number. For example, use a visual fraction model to express 3 × (2/5) as 6 × (1/5), recognizing this product as 6/5. (In general, n × (a/b) = (n × a)/b.)',
              },
              {
                code: '4.NF.B.4.c',
                norm: '4.NF.4c',
                wording:
                  'Solve word problems involving multiplication of a fraction by a whole number, e.g., by using visual fraction models and equations to represent the problem. For example, if each person at a party will eat 3/8 of a pound of roast beef, and there will be 5 people at the party, how many pounds of roast beef will be needed? Between what two whole numbers does your answer lie?',
              },
            ],
          },
        ],
      },
      {
        code: '4.NF.C',
        norm: '4.NF.C',
        label: 'Understand decimal notation for fractions, and compare decimal fractions.',
        children: [
          {
            code: '4.NF.C.5',
            norm: '4.NF.5',
            wording:
              'Express a fraction with denominator 10 as an equivalent fraction with denominator 100, and use this technique to add two fractions with respective denominators 10 and 100. For example, express 3/10 as 30/100, and add 3/10 + 4/100 = 34/100.',
            emphasis: 'Major',
          },
          {
            code: '4.NF.C.6',
            norm: '4.NF.6',
            wording:
              'Use decimal notation for fractions with denominators 10 or 100. For example, rewrite 0.62 as 62/100; describe a length as 0.62 meters; locate 0.62 on a number line diagram.',
            emphasis: 'Major',
          },
          {
            code: '4.NF.C.7',
            norm: '4.NF.7',
            wording:
              'Compare two decimals to hundredths by reasoning about their size. Recognize that comparisons are valid only when the two decimals refer to the same whole. Record the results of comparisons with the symbols >, =, or <, and justify the conclusions, e.g., by using a visual model.',
            emphasis: 'Major',
          },
        ],
      },
    ],
  },
  {
    code: '4.MD',
    norm: '4.MD',
    label: 'Measurement & Data',
    children: [
      {
        code: '4.MD.A',
        norm: '4.MD.A',
        label:
          'Solve problems involving measurement and conversion of measurements from a larger unit to a smaller unit.',
        children: [
          {
            code: '4.MD.A.1',
            norm: '4.MD.1',
            wording:
              'Know relative sizes of measurement units within one system of units including km, m, cm; kg, g; lb, oz.; l, ml; hr, min, sec. Within a single system of measurement, express measurements in a larger unit in terms of a smaller unit. Record measurement equivalents in a two-column table. For example, know that 1 ft is 12 times as long as 1 in. Express the length of a 4 ft snake as 48 in. Generate a conversion table for feet and inches listing the number pairs (1, 12), (2, 24), (3, 36), …',
            emphasis: 'Supporting',
          },
          {
            code: '4.MD.A.2',
            norm: '4.MD.2',
            wording:
              'Use the four operations to solve word problems involving distances, intervals of time, liquid volumes, masses of objects, and money, including problems involving simple fractions or decimals, and problems that require expressing measurements given in a larger unit in terms of a smaller unit. Represent measurement quantities using diagrams such as number line diagrams that feature a measurement scale.',
            emphasis: 'Supporting',
          },
          {
            code: '4.MD.A.3',
            norm: '4.MD.3',
            wording:
              'Apply the area and perimeter formulas for rectangles in real world and mathematical problems. For example, find the width of a rectangular room given the area of the flooring and the length, by viewing the area formula as a multiplication equation with an unknown factor.',
            emphasis: 'Supporting',
          },
        ],
      },
      {
        code: '4.MD.B',
        norm: '4.MD.B',
        label: 'Represent and interpret data.',
        children: [
          {
            code: '4.MD.B.4',
            norm: '4.MD.4',
            wording:
              'Make a line plot to display a data set of measurements in fractions of a unit (1/2, 1/4, 1/8). Solve problems involving addition and subtraction of fractions by using information presented in line plots. For example, from a line plot find and interpret the difference in length between the longest and shortest specimens in an insect collection.',
            emphasis: 'Supporting',
          },
        ],
      },
      {
        code: '4.MD.C',
        norm: '4.MD.C',
        label: 'Geometric measurement: understand concepts of angle and measure angles.',
        children: [
          {
            code: '4.MD.C.5',
            norm: '4.MD.5',
            wording:
              'Recognize angles as geometric shapes that are formed wherever two rays share a common endpoint, and understand concepts of angle measurement.',
            emphasis: 'Additional',
            children: [
              {
                code: '4.MD.C.5.a',
                norm: '4.MD.5a',
                wording:
                  'An angle is measured with reference to a circle with its center at the common endpoint of the rays, by considering the fraction of the circular arc between the points where the two rays intersect the circle. An angle that turns through 1/360 of a circle is called a “one-degree angle,” and can be used to measure angles.',
              },
              {
                code: '4.MD.C.5.b',
                norm: '4.MD.5b',
                wording: 'An angle that turns through n one-degree angles is said to have an angle measure of n degrees.',
              },
            ],
          },
          {
            code: '4.MD.C.6',
            norm: '4.MD.6',
            wording: 'Measure angles in whole-number degrees using a protractor. Sketch angles of specified measure.',
            emphasis: 'Additional',
          },
          {
            code: '4.MD.C.7',
            norm: '4.MD.7',
            wording:
              'Recognize angle measure as additive. When an angle is decomposed into non-overlapping parts, the angle measure of the whole is the sum of the angle measures of the parts. Solve addition and subtraction problems to find unknown angles on a diagram in real world and mathematical problems, e.g., by using an equation with a symbol for the unknown angle measure.',
            emphasis: 'Additional',
          },
        ],
      },
    ],
  },
  {
    code: '4.G',
    norm: '4.G',
    label: 'Geometry',
    children: [
      {
        code: '4.G.A',
        norm: '4.G.A',
        label: 'Draw and identify lines and angles, and classify shapes by properties of their lines and angles.',
        children: [
          {
            code: '4.G.A.1',
            norm: '4.G.1',
            wording:
              'Draw points, lines, line segments, rays, angles (right, acute, obtuse), and perpendicular and parallel lines. Identify these in two-dimensional figures.',
            emphasis: 'Additional',
          },
          {
            code: '4.G.A.2',
            norm: '4.G.2',
            wording:
              'Classify two-dimensional figures based on the presence or absence of parallel or perpendicular lines, or the presence or absence of angles of a specified size. Recognize right triangles as a category, and identify right triangles.',
            emphasis: 'Additional',
          },
          {
            code: '4.G.A.3',
            norm: '4.G.3',
            wording:
              'Recognize a line of symmetry for a two-dimensional figure as a line across the figure such that the figure can be folded along the line into matching parts. Identify line-symmetric figures and draw lines of symmetry.',
            emphasis: 'Additional',
          },
        ],
      },
    ],
  },
]

// TEKS §111.26 Grade 6 content standards. 6.1 (mathematical process standards)
// is excluded — process standards describe how students acquire and demonstrate
// understanding, not assessable mathematical content.
export const teksG6Tree: StandardNode[] = [
  {
    code: '6.2',
    norm: '6.2',
    label:
      'Number and operations: the student applies mathematical process standards to represent and use rational numbers in a variety of forms.',
    children: [
      {
        code: '6.2(A)',
        norm: '6.2A',
        wording:
          'Classify whole numbers, integers, and rational numbers using a visual representation such as a Venn diagram to describe relationships between sets of numbers.',
        emphasis: 'Supporting',
      },
      {
        code: '6.2(B)',
        norm: '6.2B',
        wording: 'Identify a number, its opposite, and its absolute value.',
        emphasis: 'Supporting',
      },
      {
        code: '6.2(C)',
        norm: '6.2C',
        wording: 'Locate, compare, and order integers and rational numbers using a number line.',
        emphasis: 'Supporting',
      },
      {
        code: '6.2(D)',
        norm: '6.2D',
        wording: 'Order a set of rational numbers arising from mathematical and real-world contexts.',
        emphasis: 'Major',
      },
      {
        code: '6.2(E)',
        norm: '6.2E',
        wording:
          'Extend representations for division to include fraction notation such as a/b represents the same number as a ÷ b where b ≠ 0.',
        emphasis: 'Supporting',
      },
    ],
  },
  {
    code: '6.3',
    norm: '6.3',
    label:
      'Number and operations: the student applies mathematical process standards to represent addition, subtraction, multiplication, and division while solving problems and justifying solutions.',
    children: [
      {
        code: '6.3(A)',
        norm: '6.3A',
        wording:
          'Recognize that dividing by a rational number and multiplying by its reciprocal result in equivalent values.',
        emphasis: 'Supporting',
      },
      {
        code: '6.3(B)',
        norm: '6.3B',
        wording:
          'Determine, with and without computation, whether a quantity is increased or decreased when multiplied by a fraction, including values greater than or less than one.',
        emphasis: 'Supporting',
      },
      {
        code: '6.3(C)',
        norm: '6.3C',
        wording:
          'Represent integer operations with concrete models and connect the actions in the models to standardized algorithms.',
        emphasis: 'Supporting',
      },
      {
        code: '6.3(D)',
        norm: '6.3D',
        wording: 'Add, subtract, multiply, and divide integers fluently.',
        emphasis: 'Major',
        fluency: true,
      },
      {
        code: '6.3(E)',
        norm: '6.3E',
        wording: 'Multiply and divide positive rational numbers fluently.',
        emphasis: 'Major',
        fluency: true,
      },
    ],
  },
  {
    code: '6.4',
    norm: '6.4',
    label:
      'Proportionality: the student applies mathematical process standards to develop an understanding of proportional relationships in problem situations.',
    children: [
      {
        code: '6.4(A)',
        norm: '6.4A',
        wording:
          'Compare two rules verbally, numerically, graphically, and symbolically in the form of y = ax or y = x + a in order to differentiate between additive and multiplicative relationships.',
        emphasis: 'Supporting',
      },
      {
        code: '6.4(B)',
        norm: '6.4B',
        wording:
          'Apply qualitative and quantitative reasoning to solve prediction and comparison of real-world problems involving ratios and rates.',
        emphasis: 'Major',
      },
      {
        code: '6.4(C)',
        norm: '6.4C',
        wording:
          'Give examples of ratios as multiplicative comparisons of two quantities describing the same attribute.',
        emphasis: 'Supporting',
      },
      {
        code: '6.4(D)',
        norm: '6.4D',
        wording:
          'Give examples of rates as the comparison by division of two quantities having different attributes, including rates as quotients.',
        emphasis: 'Supporting',
      },
      {
        code: '6.4(E)',
        norm: '6.4E',
        wording: 'Represent ratios and percents with concrete models, fractions, and decimals.',
        emphasis: 'Supporting',
      },
      {
        code: '6.4(F)',
        norm: '6.4F',
        wording:
          'Represent benchmark fractions and percents such as 1%, 10%, 25%, 33 1/3%, and multiples of these values using 10 by 10 grids, strip diagrams, number lines, and numbers.',
        emphasis: 'Supporting',
      },
      {
        code: '6.4(G)',
        norm: '6.4G',
        wording:
          'Generate equivalent forms of fractions, decimals, and percents using real-world problems, including problems that involve money.',
        emphasis: 'Major',
      },
      {
        code: '6.4(H)',
        norm: '6.4H',
        wording:
          'Convert units within a measurement system, including the use of proportions and unit rates.',
        emphasis: 'Major',
      },
    ],
  },
  {
    code: '6.5',
    norm: '6.5',
    label:
      'Proportionality: the student applies mathematical process standards to solve problems involving proportional relationships.',
    children: [
      {
        code: '6.5(A)',
        norm: '6.5A',
        wording:
          'Represent mathematical and real-world problems involving ratios and rates using scale factors, tables, graphs, and proportions.',
        emphasis: 'Supporting',
      },
      {
        code: '6.5(B)',
        norm: '6.5B',
        wording:
          'Solve real-world problems to find the whole given a part and the percent, to find the part given the whole and the percent, and to find the percent given the part and the whole, including the use of concrete and pictorial models.',
        emphasis: 'Major',
      },
      {
        code: '6.5(C)',
        norm: '6.5C',
        wording: 'Use equivalent fractions, decimals, and percents to show equal parts of the same whole.',
        emphasis: 'Supporting',
      },
    ],
  },
  {
    code: '6.6',
    norm: '6.6',
    label:
      'Expressions, equations, and relationships: the student applies mathematical process standards to use multiple representations to describe algebraic relationships.',
    children: [
      {
        code: '6.6(A)',
        norm: '6.6A',
        wording: 'Identify independent and dependent quantities from tables and graphs.',
        emphasis: 'Supporting',
      },
      {
        code: '6.6(B)',
        norm: '6.6B',
        wording:
          'Write an equation that represents the relationship between independent and dependent quantities from a table.',
        emphasis: 'Supporting',
      },
      {
        code: '6.6(C)',
        norm: '6.6C',
        wording:
          'Represent a given situation using verbal descriptions, tables, graphs, and equations in the form y = kx or y = x + b.',
        emphasis: 'Major',
      },
    ],
  },
  {
    code: '6.7',
    norm: '6.7',
    label:
      'Expressions, equations, and relationships: the student applies mathematical process standards to develop concepts of expressions and equations.',
    children: [
      {
        code: '6.7(A)',
        norm: '6.7A',
        wording:
          'Generate equivalent numerical expressions using order of operations, including whole number exponents and prime factorization.',
        emphasis: 'Major',
      },
      {
        code: '6.7(B)',
        norm: '6.7B',
        wording: 'Distinguish between expressions and equations verbally, numerically, and algebraically.',
        emphasis: 'Supporting',
      },
      {
        code: '6.7(C)',
        norm: '6.7C',
        wording:
          'Determine if two expressions are equivalent using concrete models, pictorial models, and algebraic representations.',
        emphasis: 'Supporting',
      },
      {
        code: '6.7(D)',
        norm: '6.7D',
        wording:
          'Generate equivalent expressions using the properties of operations: inverse, identity, commutative, associative, and distributive properties.',
        emphasis: 'Major',
      },
    ],
  },
  {
    code: '6.8',
    norm: '6.8',
    label:
      'Expressions, equations, and relationships: the student applies mathematical process standards to use geometry to represent relationships and solve problems.',
    children: [
      {
        code: '6.8(A)',
        norm: '6.8A',
        wording:
          'Extend previous knowledge of triangles and their properties to include the sum of angles of a triangle, the relationship between the lengths of sides and measures of angles in a triangle, and determining when three lengths form a triangle.',
        emphasis: 'Supporting',
      },
      {
        code: '6.8(B)',
        norm: '6.8B',
        wording:
          'Model area formulas for parallelograms, trapezoids, and triangles by decomposing and rearranging parts of these shapes.',
        emphasis: 'Supporting',
      },
      {
        code: '6.8(C)',
        norm: '6.8C',
        wording:
          'Write equations that represent problems related to the area of rectangles, parallelograms, trapezoids, and triangles and volume of right rectangular prisms where dimensions are positive rational numbers.',
        emphasis: 'Supporting',
      },
      {
        code: '6.8(D)',
        norm: '6.8D',
        wording:
          'Determine solutions for problems involving the area of rectangles, parallelograms, trapezoids, and triangles and volume of right rectangular prisms where dimensions are positive rational numbers.',
        emphasis: 'Major',
      },
    ],
  },
  {
    code: '6.9',
    norm: '6.9',
    label:
      'Expressions, equations, and relationships: the student applies mathematical process standards to use equations and inequalities to represent situations.',
    children: [
      {
        code: '6.9(A)',
        norm: '6.9A',
        wording:
          'Write one-variable, one-step equations and inequalities to represent constraints or conditions within problems.',
        emphasis: 'Supporting',
      },
      {
        code: '6.9(B)',
        norm: '6.9B',
        wording:
          'Represent solutions for one-variable, one-step equations and inequalities on number lines.',
        emphasis: 'Supporting',
      },
      {
        code: '6.9(C)',
        norm: '6.9C',
        wording:
          'Write corresponding real-world problems given one-variable, one-step equations or inequalities.',
        emphasis: 'Supporting',
      },
    ],
  },
  {
    code: '6.10',
    norm: '6.10',
    label:
      'Expressions, equations, and relationships: the student applies mathematical process standards to use equations and inequalities to solve problems.',
    children: [
      {
        code: '6.10(A)',
        norm: '6.10A',
        wording:
          'Model and solve one-variable, one-step equations and inequalities that represent problems, including geometric concepts.',
        emphasis: 'Major',
      },
      {
        code: '6.10(B)',
        norm: '6.10B',
        wording:
          'Determine if the given value(s) make(s) one-variable, one-step equations or inequalities true.',
        emphasis: 'Supporting',
      },
    ],
  },
  {
    code: '6.11',
    norm: '6.11',
    label:
      'Measurement and data: the student applies mathematical process standards to use coordinate geometry to identify locations on a plane.',
    children: [
      {
        code: '6.11(A)',
        norm: '6.11A',
        wording: 'Graph points in all four quadrants using ordered pairs of rational numbers.',
        emphasis: 'Major',
      },
    ],
  },
  {
    code: '6.12',
    norm: '6.12',
    label:
      'Measurement and data: the student applies mathematical process standards to use numerical or graphical representations to analyze problems.',
    children: [
      {
        code: '6.12(A)',
        norm: '6.12A',
        wording:
          'Represent numeric data graphically, including dot plots, stem-and-leaf plots, histograms, and box plots.',
        emphasis: 'Supporting',
      },
      {
        code: '6.12(B)',
        norm: '6.12B',
        wording:
          'Use the graphical representation of numeric data to describe the center, spread, and shape of the data distribution.',
        emphasis: 'Supporting',
      },
      {
        code: '6.12(C)',
        norm: '6.12C',
        wording:
          'Summarize numeric data with numerical summaries, including the mean and median (measures of center) and the range and interquartile range (IQR) (measures of spread), and use these summaries to describe the center, spread, and shape of the data distribution.',
        emphasis: 'Major',
      },
      {
        code: '6.12(D)',
        norm: '6.12D',
        wording:
          'Summarize categorical data with numerical and graphical summaries, including the mode, the percent of values in each category (relative frequency table), and the percent bar graph, and use these summaries to describe the data distribution.',
        emphasis: 'Major',
      },
    ],
  },
  {
    code: '6.13',
    norm: '6.13',
    label:
      'Measurement and data: the student applies mathematical process standards to use numerical or graphical representations to solve problems.',
    children: [
      {
        code: '6.13(A)',
        norm: '6.13A',
        wording:
          'Interpret numeric data summarized in dot plots, stem-and-leaf plots, histograms, and box plots.',
        emphasis: 'Major',
      },
      {
        code: '6.13(B)',
        norm: '6.13B',
        wording: 'Distinguish between situations that yield data with and without variability.',
        emphasis: 'Supporting',
      },
    ],
  },
  {
    code: '6.14',
    norm: '6.14',
    label:
      'Personal financial literacy: the student applies mathematical process standards to develop an economic way of thinking and problem solving useful in one’s life as a knowledgeable consumer and investor.',
    children: [
      {
        code: '6.14(A)',
        norm: '6.14A',
        wording:
          'Compare the features and costs of a checking account and a debit card offered by different local financial institutions.',
        emphasis: 'Supporting',
      },
      {
        code: '6.14(B)',
        norm: '6.14B',
        wording: 'Distinguish between debit cards and credit cards.',
        emphasis: 'Supporting',
      },
      {
        code: '6.14(C)',
        norm: '6.14C',
        wording: 'Balance a check register that includes deposits, withdrawals, and transfers.',
        emphasis: 'Supporting',
      },
      {
        code: '6.14(D)',
        norm: '6.14D',
        wording: 'Explain why it is important to establish a positive credit history.',
        emphasis: 'Supporting',
      },
      {
        code: '6.14(E)',
        norm: '6.14E',
        wording: 'Describe the information in a credit report and how long it is retained.',
        emphasis: 'Supporting',
      },
      {
        code: '6.14(F)',
        norm: '6.14F',
        wording: 'Describe the value of credit reports to borrowers and to lenders.',
        emphasis: 'Supporting',
      },
      {
        code: '6.14(G)',
        norm: '6.14G',
        wording:
          'Explain various methods to pay for college, including through savings, grants, scholarships, student loans, and work-study.',
        emphasis: 'Supporting',
      },
      {
        code: '6.14(H)',
        norm: '6.14H',
        wording:
          'Compare the annual salary of several occupations requiring various levels of post-secondary education or vocational training and calculate the effects of the different annual salaries on lifetime income.',
        emphasis: 'Supporting',
      },
    ],
  },
]
