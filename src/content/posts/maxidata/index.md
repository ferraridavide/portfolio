---
title: "My Time at Maxidata"
pubDate: 2025-02-28
cover: ./cover.jpg
description: "A reflection on nearly five years as a software developer at Maxidata, working with React, Blazor, C#, and building enterprise solutions while balancing university studies."
---

In the summer of 2020 I was wrapping up my first year of university. Like most of my classmates, I was still adjusting to this new environment and trying to find my way through classes and exams. It was a weird time—everything felt new, and on top of that, the world was in the middle of a global pandemic.

I first heard about Maxidata through word of mouth—a friend mentioned the company was looking for a software developer. Curious, I decided to get in touch, and interestingly enough, they required some of the same technologies I had just started teaching myself during the lockdown.

With the world at a standstill, I had taken the opportunity to dive into something new. I started experimenting with React and Flutter, building small projects, breaking things just to fix them. I also had some experience with C# and WPF from previous projects, which happened to be a big part of their tech stack, it almost felt like a sign.

I didn’t have much of a CV—just a few personal projects, a strong curiosity, and a willingness to learn. But I thought, *"I have nothing to lose and everything to learn"* so I just went for it.

A few days later, I got a reply.

The interview itself was straightforward—just me talking about a few projects I'd built and what I hoped to learn. Soon enough, they offered me the position. That's when I had to make a real choice.

This wasn’t a summer internship. This was an actual job. I would have to balance work and university, something none of my friends were doing. A part of me wondered if I was making a mistake—biting off more than I could chew and making university unnecessarily difficult.

What made all the difference was how flexible Maxidata was and has been. They understood that I was a student first. They let me start with just 8 hours a week, giving me room to adjust. That trust gave me the confidence to take the leap.

I still remember my first day. It was a quiet summer morning, and the office was empty except for me and Federico, who would soon become my mentor. He sat me down at his desk, pulled out a pen and paper, and started drawing. Three simple squares appeared on the blank sheet, connected by arrows. 

"*This is our SQL database,*" he explained, drawing the first square. "*This is our backend, also referred to as the BLL, and this is the WPF client.*" 

That was my introduction to *uve* (short for *uve2k.blue*), Maxidata's flagship product. We spent that morning going through the fundamentals—how the system was structured, how data moved through it, and how all the pieces fit together.

The best part about working at Maxidata has been the learning curve. Some days were harder than others, sure, but it never felt overwhelming. Many times over the years, I felt I was being challenged—but in a good way, in a way that was rewarding, difficult yet satisfying, and ultimately fulfilling. Especially in the early days, I’d get home feeling like I had learned something new. Work was fun, and I'd often realize it was time to leave only because others were starting to pack up.

There’s a saying:

> _"Find a job you love, and you will never have to work a day in your life."_

I always thought that was an exaggeration. Turns out, it’s not.

Because we were a small team, I got to work on almost everything—frontend, backend, database, migrations, architecture, deployment, high-level planning. The more time passed, the more I felt like my voice was heard and my opinions mattered in decision-making. It wasn’t just about writing code; it was about understanding the system, shaping it, and making meaningful improvements.

### What I Built

Over the years, I got to work on some really cool projects.

The biggest one, by far, was the new Blazor-based frontend, which is expected to be part of the next evolution of _uve_ as Maxidata moves away from its legacy desktop client and transitions to the web. Under the technical leadership of Federico, I built this project from scratch and maintained it alone for some time—until a colleague joined, whose tasks I helped coordinate. This was the project where I had the most technical freedom, making key decisions about how things were structured and built.

This new frontend follows a micro-frontend architecture, with a host app and many independent modules. Each module could be developed and deployed separately and enabled based on user licenses. Building this wasn’t just about working on the UI. A lot of backend work had to happen too. We had to move from SOAP services to REST, design new APIs in a consistent way, and make sure they handled things like pagination and caching properly. Every day, I’d bounce between frontend and backend—writing new services, making sure they worked smoothly with the client, and keeping performance in check.

Speaking of which, one of the biggest performance challenges came from handling and displaying large datasets. Our clients often need to display tens of thousands of rows in grid components, which quickly exposed the limits of existing component libraries (and of the framework—Blazor still has a long way to go). We tested different options, but none performed well enough. So, I decided to bite the bullet and build a custom grid component from scratch, with support for sorting, filtering, and virtualization. To keep it fast, I had to make sure re-renders were performed surgically—only updating the bare minimum parts instead of rerendering entire sections. This made a huge difference in keeping the UI smooth and responsive.

I also worked on Analyzer, a module for _uve_ that aids in the creation of customer-specific reports and statistics, cutting down on one-off feature requests. It's also used to expose data to Power BI.

I helped the team migrate from TFS to Git, which, if you’ve ever dealt with TFS, you’ll know was a much-needed change. I worked on integrating telemetry into our backend, helped configure CI/CD pipelines, set up a platform to help with creating and maintaining documentation—both for internal use and for customers, and I even got to experiment with AI-powered solutions, testing ways they could improve both internal processes and the product itself.

<div style="display: grid; justify-content: center;"><blockquote class="twitter-tweet"><p lang="en" dir="ltr">Helped my team start to transition my company’s main products code base from TFS to Git, resulting in a first commit of ~18k files and ~5.3M LOC added 🤯 <a href="https://t.co/2K1l89BpZb">pic.twitter.com/2K1l89BpZb</a></p>&mdash; Davide Ferrari (@frrdavide) <a href="https://twitter.com/frrdavide/status/1812552975589814447?ref_src=twsrc%5Etfw">July 14, 2024</a></blockquote></div><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>

### Looking Back

As I wrap up my time at Maxidata, I feel grateful more than anything. This job shaped me in ways I never expected. It gave me hands-on experience that university never could, and at the same time, it helped me appreciate what I was learning at university even more. When I started, I was just a student with a passion for coding and a strong desire to learn. Now, I leave not just as a better developer but as someone who understands what it means to build something real—something that people rely on every day.

I stayed for almost five years because Maxidata made it easy to stay. They understood my situation, gave me the freedom to balance work and study, and trusted me to grow into my role. That’s rare. And I don’t take it for granted. 

Maxidata was where I took my first steps in the world of software development, and I couldn’t have asked for a better place to start.

Thank you, Maxidata.
