import { select } from 'd3-selection';

const _App = window._App;

describe('NavBar search', () => {
  const holder = select('body').append('div');
  holder.append('div').attr('id', 'navbaraaa');
  let app;
  beforeAll(done => {
    app = _App(
      '#navbaraaa',
      {
        testdata: 'fakeTools',
        showAllFiles: true,
        showAllProjects: true,
      },
      () => {
        app.$router.push('/download');
        app.$store.commit('setCurrToolName', 'x4');
        setTimeout(() => {
          done();
        }, 500);
      },
    );
  });

  it('should display 10 rows for term=_c', done => {
    const searchTerm = '_c';
    holder.select('#sjcda-nav-search-bar').property('value', searchTerm);
    app.$store.commit('setSearchTerm', searchTerm);
    setTimeout(() => {
      expect(holder.selectAll('#file-status-table-body tr').size()).toEqual(6);
      done();
    }, 50);
  });

  afterAll(done => {
    select('#aaa').remove();
    done();
  });
});
