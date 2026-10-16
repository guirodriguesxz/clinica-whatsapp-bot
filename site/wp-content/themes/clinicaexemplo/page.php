<?php get_header(); ?><main id="conteudo" class="page-main"><article class="container"><?php while (have_posts()) { the_post(); ?><h1><?php the_title(); ?></h1><?php the_content(); } ?></article></main><?php get_footer(); ?>

