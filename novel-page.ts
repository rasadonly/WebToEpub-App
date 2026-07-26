import { getChapterId, getMetaProperty } from './helpers';
import { LatestChapterInfo, Novel } from './model';
import { load } from './wrapper';

export async function parseNovelPage(slug: string) {
  const url = `https://freewebnovel.com/${slug}.html`;
  try {
    const $ = await load(url);

    const title = getTitle($);
    const rating = parseFloat(getRating($));
    const description = getDescription($);
    const alternativeTitles = getAlternativeTitles($);
    const authors = getAuthor($);
    const genres = getGenres($);
    const type = getType($);
    const status = getStatus($);
    const imageUrl = getImageUrl($);
    const latestUpdate = await getLatestUpdate($);
    return {
      slug,
      title,
      imageUrl,
      alternativeTitles,
      rating,
      description,
      authors,
      genres,
      type,
      status,
      latestUpdate,
    } as Novel;
  } catch (error) {
    throw error;
  }
}

function getTitle($: cheerio.Root) {
  return getMetaProperty($, 'og:title');
}
function getRating($: cheerio.Root) {
  const text = $('div.score p.vote')
    .first()
    .text();
  return (
    text
      .split('/')
      .shift()
      ?.trim() ?? '0'
  );
}

function getDescription($: cheerio.Root) {
  const text = $('div.m-desc div.txt p')
    .map((_index, elem) => {
      return $(elem).text();
    })
    .get()
    .join('\n');

  return text;
}

function getAlternativeTitles($: cheerio.Root) {
  const text = $("span[title='Alternative names']")
    .siblings()
    .first()
    .text();
  return text.replace(/\n/g, '');
}

function getAuthor($: cheerio.Root) {
  const author = getMetaProperty($, 'og:novel:author')
    ?.split(',')
    .map(genre => genre.trim());

  return author;
}

function getGenres($: cheerio.Root) {
  const genre = getMetaProperty($, 'og:novel:genre')
    ?.split(',')
    .map(genre => genre.trim());

  return genre;
}

function getType($: cheerio.Root) {
  const type = getMetaProperty($, 'og:novel:category');

  return type;
}

function getStatus($: cheerio.Root) {
  const type = getMetaProperty($, 'og:novel:status');

  return type;
}

function getImageUrl($: cheerio.Root) {
  const imgUrl = getMetaProperty($, 'og:image');
  return imgUrl;
}

async function getLatestUpdate($: cheerio.Root) {
  const url = getMetaProperty($, 'og:novel:lastest_chapter_url');
  const title = getMetaProperty($, 'og:novel:lastest_chapter_name');
  const chapterId = getChapterId(url);

  const $$ = await load(url);
  const teaserText = $$('div.m-read div.txt')
    .children('p')
    .slice(0, 4)
    .map((_index, elem) => {
      if ($(elem).children('strong').length) return '';

      return $(elem).text();
    })
    .get()
    .join('\n');

  return {
    title,
    chapterId,
    datePosted: new Date().toISOString(),
    teaserText,
  } as LatestChapterInfo;
}
