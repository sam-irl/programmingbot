var mediawiki = require('nodemw');
var bot = new mediawiki({
    protocol: 'https',
    server: 'en.wikipedia.org',
    path: '/w',
    debug: false,
    userAgent: 'ProgrammingBot <https://en.wikipedia.org/wiki/User:ProgrammingBot>'
});

const TEMPLATE_PAGE_ID = '3045523';
const SHUTOFF_PAGE_ID = '59047314';

// Would be set in actual code
let password;

bot.logIn('ProgrammingBot', password, (err, res) => {
    if (err) {
        console.log(err);
        return;
    }
});

/**
 * Function returns the output of an api call to list all
 * subcategories of a given category. Function only returns
 * titles.
 *
 * @param {String} cat 
 * @return {String[]} titles
 */
function getSubcategories(cat) {
    return new Promise((resolve, reject) => {
        var sub = [];
        var error;
        bot.api.call({
            action: 'query',
            list: 'categorymembers',
            cmtitle: cat,
            cmtype: 'subcat',
            cmlimit: 'max',
            cmprop: 'title'
        }, (err, info, next, data) => {
            if (err) {
                reject(err);
            } else {
                data.query.categorymembers.forEach(function (page) {
                    sub.push(page.title);
                });
                resolve(sub);
            }
        });
    });
}

/**
 * Returns all of the articles (pages) in a category.
 * Operates similarly to getSubcategories, but requests
 * 'page' instead of 'subcat'.
 *
 * @param {String} cat 
 * @return {String[]} titles
 */
function getPagesInCategory(cat) {
    return new Promise((resolve, reject) => {
        var pages = [];
        var error;
        bot.api.call({
            action: 'query',
            list: 'categorymembers',
            cmtitle: cat,
            cmtype: 'page',
            cmlimit: 'max',
            cmprop: 'title',
            cmnamespace: '0'
        }, (err, info, next, data) => {
            if (err) {
                reject(err);
            } else {
                data.query.categorymembers.forEach(function (page) {
                    pages.push(page.title);
                });
                resolve(pages);
            }
        });
    });
}

/**
 * Uses getSubcategories and getPagesInCategory to
 * list all of the pages in a category recursively.
 *
 * @param {String} cat 
 * @return {String[]} titles
 */
function getAllPagesInCategory(cat) {
    // Welcome to asyncronous hell, hope you enjoy your stay.
    return new Promise((resolve, reject) => {
        var pagePromise = getPagesInCategory(cat);
        var subcatPromise = getSubcategories(cat);
        var pages = [];
        var subcatPages = [];
        pagePromise.then((pageList) => {
            pageList.forEach(page => {
                pages.push(page);
            });
            subcatPromise.then((subcats) => {
                var promiseArray = [];
                subcats.forEach(subcat => {
                    promiseArray.push(getPagesInCategory(subcat));
                });
                Promise.all(promiseArray).then(resolutions => {
                    function results() {
                        return new Promise((resolve, reject) => {
                            var pages = [];
                            resolutions.forEach(resolution => {
                                resolution.forEach(page => {
                                    pages.push(page);
                                });
                            });
                            resolve(pages);
                        });
                    }
                    results().then(scpg => {
                        pages = pages.concat(scpg);
                        resolve(pages);
                    });
                }, err => {
                    console.error(err);
                    reject(err);
                });
            }, (err) => {
                console.error(err);
                reject(err);
            });
        }, (err) => {
            console.error(err);
            reject(err);
        });
    });
}

/**
 * Checks if [[User:ProgrammingBot/shutoff]] has data.
 * If it does, bot will not run.
 *
 * @return {Boolean}
 */
function isShutoff() {
    return new Promise((resolve, reject) => {
        bot.api.call({
            action: 'query',
            titles: 'User:ProgrammingBot/shutoff',
            prop: 'info'
        }, (err, info, next, data) => {
            if (err) {
                console.error(err);
                reject(err);
            } else {
                resolve(info.pages[SHUTOFF_PAGE_ID].length > 0);
            }
        });
    });
}

/**
 * Uses getAllPagesInCategory to generate a list of talk pages,
 * which is what we will be operating on.
 *
 * @param {String} category
 * @return {String[]} talk pages
 */
function getTalkPagesOfPagesInCategory(category) {
    return new Promise((resolve, reject) => {
        getAllPagesInCategory(category).then(pages => {
            var res = [];
            pages.forEach(page => {
                res.push("Talk:" + page);
            });
            resolve(res);
        }, err => {
            reject(err);
        })
    });
}

/**
 * Returns a list of the titles of the templates
 * transcluded on the page.
 *
 * @param {String} page 
 * @return {String[]} templates
 */
function getTemplatesOnPage(page) {
    return new Promise((resolve, reject) => {
        bot.api.call({
            action: 'query',
            prop: 'templates',
            titles: page,
            indexpageids: 1,
            limit: 'max'
        }, (err, info, next, data) => {
            if (err) {
                reject(err);
            } else {
                var tempTitles = [];
                if (!info.pages[info.pageids[0]].templates) {
                    resolve([]);
                    return;
                }
                info.pages[info.pageids[0]].templates.forEach(template => {
                    tempTitles.push(template.title);
                })
                resolve(tempTitles);
            }
        });
    });
}

/**
 * Gets a list of all pages that redirect to the given
 * page.
 *
 * @param {String} page 
 */
function getRedirects(page) {
    return new Promise((resolve, reject) => {
        bot.api.call({
            action: 'query',
            prop: 'redirects',
            titles: page,
            indexpageids: 1
        }, (err, info, next, data) => {
            if (err) {
                reject(err);
            } else {
                var redirects = [];
                if (!info.pages[info.pageids[0]].redirects) {
                    resolve([]);
                    return;
                }
                info.pages[info.pageids[0]].redirects.forEach(redir => {
                    redirects.push(redir.title);
                });
                resolve(redirects);
            }
        })
    });
}

/**
 * Checks if {{WikiProject Protected areas}}, or any templates that redirect
 * to it, are already on the page.
 *
 * @param {String} page 
 * @return {Boolean}
 */
function checkTemplatesExists(page) {
    return new Promise((resolve, reject) => {
        getRedirects('Template:WikiProject Protected areas').then(pages => {
            // Incl. exclusion compliance
            var pagesToCheck = ['Template:WikiProject Protected areas', ...pages];
            getTemplatesOnPage(page).then(templates => {
                var found = false;
                templates.forEach(template => {
                    pagesToCheck.forEach(pg => {
                        if (template === pg) {
                            found = true;
                        }
                    });
                });
                resolve(found); 
            }, err => {
                reject(err);
            });
        }, err => {
            reject(err);
        });
    });
}

/**
 * Checks if {{Bots}} or templates that redirect to it are present,
 * ensuring exclusion compliance.
 *
 * @param {String} page 
 * @return {Boolean}
 */
function checkExcluded(page) {
    return new Promise((resolve, reject) => {
        getRedirects('Template:Bots').then(redirects => {
            var pagesToCheck = ['Template:Bots', ...redirects];
            getTemplatesOnPage(page).then(templates => {
                var found = false;
                templates.forEach(template => {
                    pagesToCheck.forEach(check => {
                        if (template === check) found = true;
                    });
                });
                resolve(found);
            }, err => {
                reject(err);
            });
        }, err => {
            reject(err);
        });
    });
}

/**
 * Uses isShutoff, checkTemplatesExists, and checkExcluded to determine
 * whether the bot should run on this page.
 *
 * @param {String} page 
 * @return {Boolean}
 */
function shouldEditPage(page) {
    return new Promise((resolve, reject) => {
        checkTemplatesExists(page).then(temp => {
            isShutoff().then(shutoff => {
                checkExcluded(page).then(excluded => {
                    checkIsRedirect(page.replace('Talk:', '')).then(redirect => {
                        resolve((!temp) && (!shutoff) && (!excluded)/* && (!redirect)*/);
                    }, err => {
                        reject(err);
                    });
                }, err => {
                    reject(err);
                });
            }, err => {
                reject(err);
            });
        }, err => {
            reject(err);
        });
    });
}

function checkIsRedirect(page) {
    return new Promise((resolve, reject) => {
        bot.api.call({
            action: 'query',
            prop: 'info',
            titles: page,
            format: 'json',
            formatversion: '2'
        }, (err, info, next, data) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(info.pages[0].redirect);
        });
    });
}

/**
 * Checks the page's class from other templates on the page.
 * Returns `false` if not found.
 *
 * @param {String} page
 * @return {String|Boolean} class 
 */
function getPageClass(page) {
    return new Promise((resolve, reject) => {
        bot.api.call({
            action: 'parse',
            page: page,
            prop: 'wikitext'
        }, (err, info, next, data) => {
            if (err) {
                if (err == 'Error: Error returned by API: The page you specified doesn\'t exist.') {
                    checkIsRedirect(page.split('Talk:')[1]).then(re => {
                        if (re) {
                            resolve('redirect');
                        } else {
                            resolve(false);
                        }
                    });
                    return;
                }
                reject(err);
                return;
            }
            var wikitext = info['wikitext']['*'];
            var rating = wikitext.split('|class=').length > 1 ? wikitext.split('|class=')[1] : false;
            if (!(wikitext.indexOf('|class=') > -1)) {
                rating = false;
            } else if ((rating.indexOf('}}') > rating.indexOf('|')) && (rating.indexOf('|') > -1)) {
                rating = rating.split('|')[0];
                rating = rating.replace(/\s+/g, '')
            } else {
                rating = rating.split('}}')[0];
                rating = rating.replace(/\s+/g, '')
            }
            resolve(rating);
        });
    });
}

/**
 * Edits the page, if it should be edited.
 * Individual page entry point.
 *
 * @param {String} page 
 */
function editPage(page) {
    shouldEditPage(page).then(should => {
        if (!should) {
            return;
        }
        var textToPrepend = '{{WikiProject Protected areas';
        getPageClass(page).then(rating => {
            var summary = 'Added {{WikiProject Protected areas}}';
            if (!rating) {
                textToPrepend += '}}';
            } else {
                textToPrepend += `|class=${rating}}}`;
                summary += `, rated as ${rating}-class`;
            }
            summary += ' (BOT)';
            bot.prepend(page, textToPrepend, summary, err => {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log('Added to page: ' + page + ', rating: ' + rating);
            });
        }, err => {
            console.error(err);
        });
    });
}

/**
 * Runs editPage on every page in a category.
 *
 * @param {String} category 
 */
function runInCategory(category) {
    getTalkPagesOfPagesInCategory(category).then(pages => {
        pages.forEach(page => {
            editPage(page);
        });
        console.log('finished queueing edits for category: ' + category);
    }, err => {
        console.error(err);
    });
}

/**
 * Entry point.
 * Runs the bot in all of its assigned categories.
 */
function run() {
    runInCategory('Category:Parks in Brooklyn');
    runInCategory('Category:Parks in the Bronx');
    runInCategory('Category:Parks in Manhattan');
    runInCategory('Category:Parks in Queens, New York');
    runInCategory('Category:Parks in Staten Island');
}

run();
