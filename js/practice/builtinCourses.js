/*
 * (update 452) Courses built into Course Prep, for everyone: the tour card (par and yards from the championship tees)
 * and a map of each hole (media/courses/<id>/<hole>.webp, drawn in the practice games' flyover style).
 */
export const BUILTIN_COURSES = [
  {
    id: "torrey-pines-south",
    name: "Torrey Pines South",
    location: "La Jolla, CA",
    tees: "Championship",
    par: [4, 4, 3, 4, 4, 5, 4, 3, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5],
    yards: [451, 389, 201, 490, 454, 564, 462, 177, 615, 454, 225, 505, 621, 437, 480, 227, 443, 570],
    holeMaps: "media/courses/torrey-pines-south",
  },
];
/** The picture of a hole, or null. */
export const holeMapUrl = (course, n) => (course?.holeMaps ? `${course.holeMaps}/${n}.webp?v=1` : null);
