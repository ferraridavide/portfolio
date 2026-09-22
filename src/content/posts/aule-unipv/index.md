---
title: "Aule UniPV: A simple way to find an empty classroom"
pubDate: 2024-10-04
cover: ./cover.jpg
description: "Aule UniPV is a web app that helps university students find empty classrooms at the University of Pavia. Built with React, TailwindCSS, Framer Motion, and Supabase."
---

**Aule UniPV is now live at [unipv.davide.im](https://unipv.davide.im/), check it out!**

Since starting university, my class schedule has been all over the place, often leaving me with random gaps to fill. I’d end up wandering through the hallways of *Nave*, moving from building to building, trying to find an empty classroom where my friends and I could settle in.

So when the Web Technologies course asked us to create a project for the final exam, I already knew what I wanted to build.

I was thinking of something simple that would save me (and other students) the hassle of running around campus trying to find a free room. That’s how Aule UniPV came to life—a web app that puts all the classroom availability data in one clean, easy-to-use interface. No more wandering—just a quick look, and you know exactly where to go.

### The idea

Aule UniPV pulls data from the official classroom schedules daily and shows it in a friendly, easy-to-use way. Classrooms are presented as a stack of swipable cards, making it super simple to just swipe through and find what's free.

If you need more details, there's a full list of all available classrooms, sorted by availability. You can easily search and filter by features like projectors, electrical outlets, windows, blackboards, and more—just a swipe away. Aule UniPV helps you see exactly what each classroom has, so you can pick the best spot for your needs. Plus, you can bookmark your favorite classrooms to find them even faster next time.

### The stack

Building Aule UniPV was actually a lot of fun and gave me the opportunity to check out some new platforms and libraries I hadn't worked with before. I got to dive into **Supabase**, which turned out to be a great backend solution for a simple project like this, especially thanks to its generous free tier. On the front end, I used **Framer Motion** to create playful interactions like the card swiping feature, which makes browsing classrooms a little more intuitive and enjoyable.

The frontend of Aule UniPV was built in **React** with **TailwindCSS** for rapid UI prototyping, the idea was to create something that felt responsive and interactive, so the user experience was as smooth as possible. I also used **TanStack Table** to provide a sophisticated data grid, which makes filtering classrooms fast and effective.

The backend is powered by **Supabase**, which turned out to be a solid choice for this project. It handled **authentication**, integrating with Google Cloud so that only students from the universitadipavia.it domain could report classroom issues, and **edge functions** for pulling updated data from the official classroom schedules.

Every morning at 6 AM, Aule UniPV automatically fetches the latest schedule information. This setup involves scheduled jobs that trigger queries to pull and update classroom availability data from the official calendars. By leveraging the pg\_cron extension for PostgreSQL the system keeps everything in sync, ensuring users always have up-to-date information without manual intervention.

The project is hosted on **GitHub Pages**, with **GitHub Actions** seamlessly managing deployment. Every push triggers an automatic build and deployment, making the process effortless and allowing for rapid iteration on features and bug fixes.
